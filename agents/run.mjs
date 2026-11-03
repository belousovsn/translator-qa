#!/usr/bin/env node
// QA personas (#747): each persona walks the test site as a user, performs the
// random environment events of its run, judges what it sees by rules.md and
// writes a report. The runner keeps the last two runs per persona with their
// traces and rebuilds the page that shows them.
//
//   node agents/run.mjs                    every runnable persona
//   node agents/run.mjs guest-ru-phone     one persona
//   options: --seed=N  --max-actions=N  --no-probe  --no-notify  --no-verify
//   node agents/run.mjs --reverify guest-ru-phone   verify the latest run again
//   node agents/run.mjs --from-queue    diff mode: deploys queued by enqueue.sh
//
// Env: TEST_BASE_URL, QA_AGENTS_HOME (data folder), QA_AGENTS_PAGE_URL,
// CLAUDE_BIN, CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMcpConfig } from './lib/browser.mjs';
import { decide, MODELS, probeLimit, runClaude } from './lib/claude.mjs';
import { planEvents } from './lib/events.mjs';
import { sendTelegram, summarize } from './lib/notify.mjs';
import { isRunnable, loadPersonas } from './lib/personas.mjs';
import { buildPrompt, extractReport } from './lib/prompt.mjs';
import { KEEP_RUNS, listRuns, renderSite } from './lib/site.mjs';
import { verifyRun } from './lib/verify.mjs';
import { writeMockFiles } from './lib/game-mock.mjs';
import { describeKnowledge, loadKnowledge, refreshIssues } from './lib/knowledge.mjs';
import { combineJobs, describeFocus, dropJobs, planDeploy, readManual, readQueue } from './lib/planner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}`));
const flagValue = (name) => flag(name)?.split('=')[1];
const ids = args.filter((a) => !a.startsWith('--'));

const BASE_URL = (process.env.TEST_BASE_URL ?? 'https://test.memdecks.com').replace(/\/$/, '');
const DATA = path.resolve(process.env.QA_AGENTS_HOME ?? path.join(here, '.data'));
const MAX_ACTIONS = Number(flagValue('max-actions') ?? 60);
const RUN_TIMEOUT_MS = 50 * 60 * 1000;

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// What the runner is doing now, for the page. The API checks `pid` is alive,
// so a crash cannot leave the page saying "running" forever.
const STATUS_FILE = () => path.join(DATA, 'status.json');
// Queue files being worked on now; the page lists only the rest as waiting.
let currentJobs = [];
function setStatus(state, extra = {}) {
  try {
    writeFileSync(STATUS_FILE(), JSON.stringify({ state, pid: process.pid, since: new Date().toISOString(), jobs: currentJobs, ...extra }));
  } catch {}
}
// The repo's accepted list plus what was decided on the page.
const known = (opts) => [readFileSync(path.join(here, 'accepted.md'), 'utf8'), describeKnowledge(loadKnowledge(DATA), opts)].filter(Boolean).join('\n\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function installTraceViewer() {
  const target = path.join(DATA, 'trace-viewer');
  if (existsSync(path.join(target, 'index.html'))) return;
  const src = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib', 'vite', 'traceViewer');
  cpSync(src, target, { recursive: true });
}

function zipDir(srcDir, zipFile) {
  // Windows' own bsdtar writes zip; a GNU tar earlier on PATH (Git Bash) cannot.
  if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', zipFile, '-C', srcDir, '.']);
  else execFileSync('zip', ['-q', '-r', zipFile, '.'], { cwd: srcDir });
}

function prune(personaId) {
  for (const old of listRuns(DATA, personaId).slice(KEEP_RUNS)) rmSync(old.dir, { recursive: true, force: true });
}

async function waitForLimit() {
  if (flag('no-probe')) return { action: 'run', reason: 'проба отключена' };
  const started = Date.now();
  for (;;) {
    const d = decide(await probeLimit());
    log('limit:', d.action, d.reason);
    if (d.action === 'wait') setStatus('waiting', { reason: d.reason, until: new Date(d.until * 1000).toISOString() });
    if (d.action !== 'wait') return { ...d, waitedMin: Math.round((Date.now() - started) / 60000) };
    const ms = d.until * 1000 - Date.now();
    if (Date.now() - started + ms > 6 * 3600 * 1000) return { action: 'skip', reason: 'ждём дольше 6 часов' };
    log(`waiting ${Math.round(ms / 60000)} min for the window to reset`);
    await sleep(Math.max(ms, 60_000));
  }
}

async function runPersona(persona, deploy = null) {
  const startedAt = new Date().toISOString();
  const runDir = path.join(DATA, 'runs', persona.id, startedAt.replace(/[:.]/g, '-'));
  mkdirSync(runDir, { recursive: true });
  const seed = Number(flagValue('seed') ?? (Date.now() & 0x7fffffff));
  const plan = planEvents(seed);
  const prompt = buildPrompt({
    persona,
    baseUrl: BASE_URL,
    rules: readFileSync(path.join(here, 'rules.md'), 'utf8'),
    accepted: known(),
    plan,
    maxActions: MAX_ACTIONS,
    focus: deploy ? describeFocus(deploy) : '',
  });
  writeFileSync(path.join(runDir, 'prompt.md'), prompt);
  writeMockFiles(runDir, BASE_URL);
  const mcpConfig = writeMcpConfig(runDir, persona);
  log(`${persona.id}: start, seed ${seed}, events ${plan.events.map((e) => e.kind).join(', ') || 'none'}, games ${plan.games.mode} ${plan.games.exits.join('/')}`);
  setStatus('running', { persona: persona.id, name: persona.name, mode: deploy ? 'deploy' : 'manual' });

  const r = await runClaude({
    prompt,
    model: MODELS.persona,
    cwd: runDir,
    logFile: path.join(runDir, 'stream.jsonl'),
    timeoutMs: RUN_TIMEOUT_MS,
    args: [
      '--mcp-config', mcpConfig,
      '--strict-mcp-config',
      '--tools', '',
      '--allowedTools', 'mcp__browser',
      '--max-turns', String(MAX_ACTIONS * 2),
    ],
  });

  const report = extractReport(r.text);
  const limited = r.rateLimits.some((x) => x.status === 'rejected');
  const status = report ? 'ok' : limited ? 'limit' : r.isError ? 'error' : 'no-report';

  // The trace lives in out/traces; the session log is the full list of tool calls.
  const tracesDir = path.join(runDir, 'out', 'traces');
  if (existsSync(tracesDir)) {
    try {
      zipDir(tracesDir, path.join(runDir, 'trace.zip'));
      rmSync(tracesDir, { recursive: true, force: true });
    } catch (e) {
      log(`${persona.id}: trace zip failed: ${e.message}`);
    }
  }
  const sessionDir = existsSync(path.join(runDir, 'out'))
    ? readdirSync(path.join(runDir, 'out')).find((d) => d.startsWith('session-'))
    : null;

  const meta = {
    persona: persona.id,
    startedAt,
    durationMs: Date.now() - Date.parse(startedAt),
    model: MODELS.persona,
    plan,
    numTurns: r.numTurns,
    status,
    error: report ? null : (r.text || r.stderr).slice(0, 400),
    rateLimits: r.rateLimits,
    sessionLog: sessionDir ? `out/${sessionDir}/session.md` : null,
    deploy: deploy ? { shas: deploy.shas, summary: deploy.summary, focus: deploy.focus } : null,
  };
  writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
  if (report) writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`${persona.id}: ${status}, ${report?.findings?.length ?? 0} findings, ${Math.round(meta.durationMs / 60000)} min`);

  let verify = null;
  if (report && !flag('no-verify')) {
    setStatus('verifying', { persona: persona.id, name: persona.name });
    verify = await verifyRun({ runDir, report, persona, rules: readFileSync(path.join(here, 'rules.md'), 'utf8'), accepted: known({ forVerifier: true }) });
    log(`${persona.id}: verified, ${verify.error ? `error: ${verify.error.slice(0, 120)}` : (verify.findings ?? []).map((v) => `${v.id} ${v.verdict}`).join(', ')}`);
  }
  return { persona, meta, report, verify, rel: path.relative(DATA, runDir).split(path.sep).join('/') };
}

async function main() {
  mkdirSync(DATA, { recursive: true });
  installTraceViewer();
  const personas = loadPersonas(path.join(here, 'personas'));
  const chosen = ids.length ? personas.filter((p) => ids.includes(p.id)) : personas.filter(isRunnable);
  const unknown = ids.filter((id) => !personas.some((p) => p.id === id));
  if (unknown.length) throw new Error(`unknown persona: ${unknown.join(', ')}`);
  if (flag('reverify')) {
    // Re-check finished runs without walking the site again.
    const runs = [];
    for (const persona of chosen) {
      const last = listRuns(DATA, persona.id)[0];
      if (!last?.report) throw new Error(`${persona.id}: no finished run with a report`);
      const verify = await verifyRun({ runDir: last.dir, report: last.report, persona, rules: readFileSync(path.join(here, 'rules.md'), 'utf8'), accepted: known({ forVerifier: true }) });
      log(`${persona.id}: verified ${last.rel}`);
      runs.push({ persona, meta: last.meta, report: last.report, verify, rel: last.rel });
    }
    renderSite(DATA, personas);
    if (!flag('no-notify')) await sendTelegram(summarize(runs, { pageUrl: process.env.QA_AGENTS_PAGE_URL }));
    return;
  }
  // Closed issues become places to look at again.
  const reopened = await refreshIssues(DATA).catch(() => 0);
  if (reopened) log(`issues: ${reopened} changed state`);
  if (flag('from-queue')) return runQueue(personas);
  const blocked = chosen.filter((p) => !isRunnable(p));
  if (blocked.length) throw new Error(`waiting for test accounts: ${blocked.map((p) => p.id).join(', ')}`);

  const decision = await waitForLimit();
  if (decision.action === 'skip') {
    if (!flag('no-notify')) await sendTelegram(`QA-агенты: прогон пропущен, ${decision.reason}`);
    log('skipped:', decision.reason);
    return;
  }

  // One persona at a time: the box has one CPU, and each run is its own Claude
  // session, so a limit that stops one persona leaves the others' results.
  const runs = [];
  for (const persona of chosen) {
    runs.push(await runPersona(persona));
    prune(persona.id);
    renderSite(DATA, personas);
  }
  renderSite(DATA, personas);
  setStatus('idle');
  if (!flag('no-notify')) await sendTelegram(summarize(runs, { pageUrl: process.env.QA_AGENTS_PAGE_URL, decision }));
}

/**
 * Diff mode. Takes every queued deploy, asks the planner whether a user can
 * see the change and who should look, runs those personas with a focus, and
 * repeats while deploys keep arriving.
 */
async function runQueue(personas) {
  const queueDir = process.env.QA_AGENTS_QUEUE ?? path.join(DATA, '..', 'queue');
  const runnable = personas.filter(isRunnable);
  for (;;) {
    // Manual runs from the page go first: someone is waiting for them.
    const [manual] = readManual(queueDir);
    if (manual) {
      currentJobs = [manual.file];
      const chosen = (manual.personas ?? []).map((id) => runnable.find((p) => p.id === id)).filter(Boolean);
      log(`manual: ${chosen.map((p) => p.id).join(', ') || 'nothing runnable'}`);
      if (chosen.length) {
        setStatus('probing');
        const decision = await waitForLimit();
        if (decision.action === 'skip') {
          if (!flag('no-notify')) await sendTelegram(`QA-агенты, ручной запуск: пропущен, ${decision.reason}`);
        } else {
          const runs = [];
          for (const persona of chosen) {
            runs.push(await runPersona(persona));
            prune(persona.id);
            renderSite(DATA, personas);
          }
          if (!flag('no-notify')) await sendTelegram(summarize(runs, { pageUrl: process.env.QA_AGENTS_PAGE_URL, decision, deploy: { head: 'ручной запуск со страницы' } }));
        }
      }
      dropJobs(queueDir, [manual]);
      currentJobs = [];
      setStatus('idle');
      continue;
    }
    const jobs = readQueue(queueDir);
    if (!jobs.length) {
      setStatus('idle');
      return;
    }
    currentJobs = jobs.map((j) => j.file);
    setStatus('planning', { shas: jobs.map((j) => j.sha) });
    const { shas, text } = combineJobs(jobs);
    log(`queue: ${shas.join(', ')}`);
    const plan = await planDeploy({ diff: text, personas: runnable, logFile: path.join(DATA, 'last-plan.jsonl') });
    const head = `после деплоя ${shas.map((s) => s.slice(0, 7)).join(', ')}`;
    if (plan.error) {
      log('planner failed:', plan.error);
      if (!flag('no-notify')) await sendTelegram(`QA-агенты ${head}: планировщик не ответил, прогон пропущен.
${plan.error.slice(0, 200)}`);
      dropJobs(queueDir, jobs);
      currentJobs = [];
      continue;
    }
    if (!plan.ui) {
      log(`no visible change: ${plan.summary ?? ''}`);
      dropJobs(queueDir, jobs);
      currentJobs = [];
      continue;
    }
    const decision = await waitForLimit();
    if (decision.action === 'skip') {
      if (!flag('no-notify')) await sendTelegram(`QA-агенты ${head}: прогон пропущен, ${decision.reason}`);
      dropJobs(queueDir, jobs);
      currentJobs = [];
      continue;
    }
    const deploy = { ...plan, shas };
    const runs = [];
    for (const id of plan.personas) {
      const persona = runnable.find((p) => p.id === id);
      runs.push(await runPersona(persona, deploy));
      prune(persona.id);
      renderSite(DATA, personas);
    }
    dropJobs(queueDir, jobs);
    currentJobs = [];
    setStatus('idle');
    if (!flag('no-notify')) await sendTelegram(summarize(runs, { pageUrl: process.env.QA_AGENTS_PAGE_URL, decision, deploy: { head, summary: plan.summary } }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
