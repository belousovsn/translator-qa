// Second pass over a persona run (#747). A separate Claude session without a
// browser reads the persona's report next to the evidence (screenshots, page
// snapshots, console and network results) and gives each finding a verdict.
// The persona cannot see its own named screenshots and sometimes reports what
// it expected rather than what happened; this pass catches that.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MODELS, runClaude } from './claude.mjs';

export const VERDICTS = {
  confirmed: 'подтверждено',
  reworded: 'переформулировано',
  rejected: 'отклонено',
  unverifiable: 'не проверить',
  known: 'известно',
};

const VERIFY_START = '<<<VERIFY';
const VERIFY_END = 'VERIFY>>>';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Turns stream.jsonl into a numbered list of what the persona did and what the
 * browser answered: page URL, screenshot and snapshot files, short result text.
 * This is the verifier's map; the files it names are the evidence.
 */
export function buildTimeline(streamFile) {
  const lines = [];
  const calls = new Map();
  let n = 0;
  for (const raw of readFileSync(streamFile, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      continue;
    }
    if (m.type === 'assistant') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'text' && c.text.trim() && !c.text.includes('<<<REPORT')) lines.push(`   думает: ${clip(c.text.trim().replace(/\s+/g, ' '), 300)}`);
        if (c.type === 'tool_use') {
          n += 1;
          calls.set(c.id, n);
          const name = c.name.replace(/^mcp__browser__browser_/, '');
          lines.push(`#${n} ${name} ${clip(JSON.stringify(c.input), 240)}`);
        }
      }
    }
    if (m.type === 'user') {
      for (const c of m.message?.content ?? []) {
        if (c?.type !== 'tool_result') continue;
        const text = Array.isArray(c.content)
          ? c.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n')
          : String(c.content ?? '');
        const url = text.match(/Page URL: (\S+)/)?.[1];
        const shot = text.match(/\[Screenshot[^\]]*\]\(([^)]+)\)/)?.[1];
        const snap = text.match(/\[Snapshot\]\(([^)]+)\)/)?.[1];
        const result = text.match(/### Result\s*\n([\s\S]*?)(?:\n###|$)/)?.[1]?.trim();
        const parts = [
          url && `url ${url}`,
          shot && `снимок ${shot.replace(/^\.\//, '')}`,
          snap && `страница ${snap}`,
          result && `ответ ${clip(result.replace(/\s+/g, ' '), 300)}`,
        ].filter(Boolean);
        lines.push(`   ← #${calls.get(c.tool_use_id) ?? '?'} ${parts.join(' · ') || clip(text.replace(/\s+/g, ' '), 200)}`);
      }
    }
  }
  return lines.join('\n');
}

export function buildVerifyPrompt({ report, rules, accepted, persona }) {
  return `Ты проверяешь отчёт другого агента. Тот агент играл роль пользователя приложения MemDecks (${persona.name}, ${persona.device}, ${persona.locale}) и записал находки. Он не видел скриншоты, которые сохранял под именем, и иногда пишет то, что ожидал, а не то, что случилось. Твоя задача: по доказательствам решить, какие находки верны.

# Что у тебя есть (файлы в текущей папке)

- report.json — отчёт агента.
- timeline.md — пронумерованный журнал его действий и ответов браузера: адрес страницы, имя снимка экрана (png), имя снимка страницы (yml, дерево доступности с текстами).
- Снимки экрана: finding-*.png в корне и out/page-*.png. Снимки страницы: out/page-*.yml.

Открывай картинки инструментом Read, он их показывает. Тексты на экране сверяй по yml.

# Правила, по которым судил агент

${rules}

${accepted}

# Как проверять каждую находку

1. Найди в timeline.md действия вокруг шага находки. Открой снимок к находке и снимки до и после.
2. Реши:
   - "confirmed" — доказательства показывают ровно то, что написано.
   - "reworded" — проблема есть, но описана неверно или преувеличена. Дай верный текст и уровень.
   - "rejected" — доказательства противоречат находке. Например, на снимке есть то, чего «нет».
   - "unverifiable" — доказательств мало, чтобы решить.
   - "known" — это уже известно (см. пункт 4).
3. Заполни "where": экран словами пользователя (вкладка, экран, окно, игра), адрес страницы из журнала, элемент на экране.
4. Совпадает с записью из «Что уже известно» (норма или открытая задача) — "known" и поле "known" с её id, например "K3". Похоже на прошлую ошибку агентов — "rejected" с причиной «как K…». Проблема из раздела «Исправлено, проверь заново» снова видна — "confirmed" или "reworded", и "observed" начинается с «Вернулось K…:».

Отдельно: если на просмотренных снимках видишь явное нарушение правил, которого агент не записал и которого нет в «Что уже известно», добавь его в "missed". Только то, что видно на снимке, без догадок. Не больше пяти.

severity: "high" если пользователь не может продолжить или теряет данные, "medium" если путь обходной или запутанный, "low" если косметика.

# Ответ

Тексты по-русски, коротко, обычными предложениями. В конце выведи ровно один JSON между строками ${VERIFY_START} и ${VERIFY_END}:

${VERIFY_START}
{
  "findings": [
    { "id": "F1", "verdict": "reworded", "reason": "на finding-F1.png варианты ответа есть; до нажатия заставка держалась 14 с", "severity": "medium", "observed": "заставка квиза с перевёрнутым словом держится больше 5 секунд без подсказки", "where": { "screen": "Игры → WordBase Quiz, заставка", "url": "https://…", "element": "весь экран игры" }, "screenshot": "out/page-….png" }
  ],
  "missed": [
    { "severity": "low", "rule": "R1", "observed": "…", "where": { "screen": "…", "url": "…", "element": "…" }, "screenshot": "out/page-….png" }
  ]
}
${VERIFY_END}

В "screenshot" укажи снимок, который лучше всего показывает проблему. Для "rejected" — тот, что её опровергает. "observed" обязателен для "reworded" и "missed".

Отчёт агента для справки:

${JSON.stringify(report, null, 2)}`;
}

export function extractVerify(text) {
  const start = text.lastIndexOf(VERIFY_START);
  const end = text.lastIndexOf(VERIFY_END);
  if (start < 0 || end < start) return null;
  const raw = text.slice(start + VERIFY_START.length, end).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Runs the verifier in a finished run folder. Writes timeline.md and verify.json. */
export async function verifyRun({ runDir, report, persona, rules, accepted, timeoutMs = 20 * 60 * 1000 }) {
  writeFileSync(path.join(runDir, 'timeline.md'), buildTimeline(path.join(runDir, 'stream.jsonl')));
  const prompt = buildVerifyPrompt({ report, rules, accepted, persona });
  writeFileSync(path.join(runDir, 'verify-prompt.md'), prompt);
  const r = await runClaude({
    prompt,
    model: MODELS.verify,
    cwd: runDir,
    logFile: path.join(runDir, 'verify-stream.jsonl'),
    timeoutMs,
    args: ['--strict-mcp-config', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--max-turns', '80'],
  });
  const verify = extractVerify(r.text);
  const out = verify
    ? { ...verify, model: MODELS.verify, numTurns: r.numTurns }
    : { error: clip(r.text || r.stderr, 400), model: MODELS.verify, numTurns: r.numTurns };
  writeFileSync(path.join(runDir, 'verify.json'), JSON.stringify(out, null, 2));
  return out;
}

/**
 * The findings to show: the persona's own, overlaid with the verifier's
 * verdict and corrections, plus what the verifier found that the persona missed.
 * Without a verify.json every finding keeps the persona's text and no verdict.
 */
export function mergeFindings(report, verify) {
  const byId = new Map((verify?.findings ?? []).map((v) => [v.id, v]));
  const own = (report?.findings ?? []).map((f) => {
    const v = byId.get(f.id);
    if (!v) return { ...f, verdict: null };
    return {
      ...f,
      verdict: v.verdict,
      reason: v.reason,
      known: v.known,
      severity: v.severity ?? f.severity,
      observed: v.verdict === 'reworded' && v.observed ? v.observed : f.observed,
      originalObserved: v.verdict === 'reworded' ? f.observed : undefined,
      where: v.where ?? f.where,
      screenshot: v.screenshot ?? f.screenshot,
    };
  });
  const missed = (verify?.missed ?? []).map((m, i) => ({ ...m, id: `V${i + 1}`, verdict: 'missed' }));
  return [...own, ...missed];
}

/** Findings that are worth a message: verified as real, or not checked at all. */
export const isShown = (f) => f.verdict == null || f.verdict === 'confirmed' || f.verdict === 'reworded' || f.verdict === 'missed';

export function readVerify(runDir) {
  const file = path.join(runDir, 'verify.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
