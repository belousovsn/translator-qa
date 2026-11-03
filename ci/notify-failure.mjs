// Sends Sergey a short Telegram note on what broke in a red E2E run.
// A test failure names the failed tests and their first error line; a run that
// broke before the tests names the step and quotes why. Reads the per-suite JSON
// reports and the browser install log the workflow leaves in ci-results/.
//
// DRY_RUN=1 prints the message instead of sending it.

import { existsSync, readFileSync } from 'node:fs';

const MAX_TESTS = 8;
const MAX_LINE = 180;

const SUITES = [
  { file: 'ci-results/safe.json', label: 'без входа' },
  { file: 'ci-results/auth.json', label: 'с аккаунтом' },
];

const STEP_NAMES = {
  deps: 'установка зависимостей',
  env: 'проверка TEST_BASE_URL',
  install: 'установка браузера',
  safe: 'тесты без входа',
  auth: 'тесты с аккаунтом',
};

const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

function firstLine(text) {
  const line = stripAnsi(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^Error:\s*$/.test(l));
  if (!line) return 'без текста ошибки';
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}

function* walk(suite, parents = []) {
  const path = suite.title ? [...parents, suite.title] : parents;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield { spec, test, path };
  }
  for (const child of suite.suites ?? []) yield* walk(child, path);
}

function readSuite({ file, label }) {
  if (!existsSync(file)) return null;
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const failed = [];
  for (const { spec, test, path } of (report.suites ?? []).flatMap((s) => [...walk(s)])) {
    if (test.status !== 'unexpected') continue;
    const last = test.results?.at(-1);
    const where = `${spec.file}:${spec.line}`;
    // The file name already heads the path; keep the describe blocks and the title.
    const title = [...path.slice(1), spec.title].join(' › ');
    failed.push(`• ${where} ${title}\n  ${firstLine(last?.error?.message ?? last?.errors?.[0]?.message)}`);
  }
  const stats = report.stats ?? {};
  const total = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0);
  return { label, failed, flaky: stats.flaky ?? 0, total };
}

function installReason() {
  const log = 'ci-results/install.log';
  if (!existsSync(log)) return null;
  const lines = stripAnsi(readFileSync(log, 'utf8')).split('\n');
  const error = lines.find((l) => /error/i.test(l));
  return error ? firstLine(error) : null;
}

function failedStep() {
  let steps = {};
  try {
    steps = JSON.parse(process.env.STEPS_JSON ?? '{}');
  } catch {
    // Without step outcomes the message still links the run.
  }
  return Object.entries(steps).find(([, s]) => s.outcome === 'failure')?.[0] ?? null;
}

function buildMessage() {
  const when = process.env.RUN_EVENT === 'schedule' ? 'Ночной' : 'Ручной';
  const runUrl = process.env.RUN_URL ?? '';
  const suites = SUITES.map(readSuite).filter(Boolean);
  const failures = suites.flatMap((s) => s.failed.map((f) => ({ suite: s.label, text: f })));

  if (failures.length > 0) {
    const counts = suites
      .filter((s) => s.total > 0)
      .map((s) => `${s.label}: упало ${s.failed.length} из ${s.total}${s.flaky ? `, нестабильных ${s.flaky}` : ''}`);
    const shown = failures.slice(0, MAX_TESTS).map((f) => f.text);
    const more = failures.length > MAX_TESTS ? [`…и ещё ${failures.length - MAX_TESTS}`] : [];
    return [`${when} UI-прогон translator-qa красный`, ...counts, '', ...shown, ...more, '', runUrl].join('\n');
  }

  // Red, but no test failed: the run broke before or around the tests.
  const step = failedStep();
  const stepName = step ? (STEP_NAMES[step] ?? step) : 'неизвестный шаг';
  const reason = step === 'install' ? installReason() : null;
  return [
    `${when} UI-прогон translator-qa не дошёл до тестов`,
    `Упал шаг: ${stepName}`,
    ...(reason ? [reason] : []),
    '',
    runUrl,
  ].join('\n');
}

const text = buildMessage();

if (process.env.DRY_RUN) {
  console.log(text);
} else {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('::warning::TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set; the alert was not sent.');
    console.log(text);
  } else {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      // The token is part of the URL, so only the status and Telegram's own answer are printed.
      console.log(`::warning::Telegram answered ${res.status}: ${await res.text()}`);
      process.exitCode = 1;
    } else {
      console.log('Alert sent.');
    }
  }
}
