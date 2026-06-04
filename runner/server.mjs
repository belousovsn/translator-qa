/**
 * translator-qa — guarded live test runner
 * ----------------------------------------
 * A small, dependency-free Node service that lets a portfolio visitor trigger a
 * curated subset of the Playwright suite against the deployed test environment
 * and watch the results stream in over Server-Sent Events (SSE).
 *
 * Safety model (why this is safe to expose):
 *   - Allowlist only: visitors pick a group id; args come from runner/groups.mjs.
 *     No visitor input is ever placed on the command line (no injection).
 *   - Single-flight: one run at a time. Concurrent requests attach to the
 *     in-progress run's stream instead of spawning another.
 *   - Per-IP + global rate limits (sliding 1h window).
 *   - Hard timeout: the child is killed if it overruns.
 *   - CORS locked to the configured portfolio origin(s).
 *   - Credentials (disposable test account, admin key) come from the runner's
 *     own environment — never from the request.
 *
 * Run:  node runner/server.mjs   (or: npm run serve)
 * Env:  see .env.example (RUNNER_* and TEST_* / ADMIN_API_KEY).
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { GROUPS, publicGroups } from './groups.mjs';

// Load .env if present (dotenv is a dev dependency of this repo). Never fatal.
try {
  await import('dotenv/config');
} catch {
  /* dotenv not installed — rely on the ambient environment */
}

/* ------------------------------------------------------------------ config */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const RUNS_DIR = path.join(ROOT, 'runner', '.runs');

const CONFIG = {
  port: Number(process.env.RUNNER_PORT ?? 8787),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  perIpPerHour: Number(process.env.RUNNER_RATE_PER_HOUR ?? 6),
  globalPerHour: Number(process.env.RUNNER_GLOBAL_PER_HOUR ?? 40),
  runTimeoutMs: Number(process.env.RUNNER_TIMEOUT_MS ?? 180000),
  maxReports: Number(process.env.RUNNER_MAX_REPORTS ?? 20),
};

// Resolve the local Playwright CLI so we never depend on a shell or `npx`.
// The packages block deep imports via "exports", so locate the bin script
// through the (exported) package.json instead.
const require = createRequire(import.meta.url);
function resolvePlaywrightCli() {
  for (const pkg of ['@playwright/test', 'playwright']) {
    try {
      const pkgJsonPath = require.resolve(`${pkg}/package.json`);
      const dir = path.dirname(pkgJsonPath);
      const pj = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const binRel = typeof pj.bin === 'string' ? pj.bin : pj.bin?.playwright;
      for (const candidate of [binRel, 'cli.js'].filter(Boolean)) {
        const cli = path.join(dir, candidate);
        if (fs.existsSync(cli)) return cli;
      }
    } catch {
      /* try the next package */
    }
  }
  throw new Error('Could not locate the Playwright CLI. Run `npm install`.');
}
const PW_CLI = resolvePlaywrightCli();

/* ------------------------------------------------------------------- state */

/** @type {Map<string, Run>} */
const runs = new Map();
/** @type {Map<string, Set<http.ServerResponse>>} */
const subscribers = new Map();
let activeRunId = null;

/** Per-IP and global run timestamps for rate limiting. */
const ipHits = new Map();
let globalHits = [];

/** group id -> number of tests (computed once via `--list`). */
const groupCounts = {};

const MAX_BUFFERED_EVENTS = 3000;

/* --------------------------------------------------------------- utilities */

function nowIso() {
  return new Date().toISOString();
}

function pruneWindow(arr) {
  const cutoff = Date.now() - 3600_000;
  return arr.filter((t) => t > cutoff);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function corsHeaders(origin) {
  const allow = origin && CONFIG.allowedOrigins.includes(origin) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (allow) headers['Access-Control-Allow-Origin'] = allow;
  return headers;
}

function sendJson(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(body));
}

/* -------------------------------------------------------------- SSE plumbing */

function broadcast(run, type, data) {
  const event = { type, data, t: Date.now() };
  run.events.push(event);
  if (run.events.length > MAX_BUFFERED_EVENTS) {
    run.events.splice(0, run.events.length - MAX_BUFFERED_EVENTS);
  }
  const subs = subscribers.get(run.id);
  if (subs) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) res.write(payload);
  }
}

function publicRun(run) {
  return {
    id: run.id,
    group: run.group,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    tests: run.tests,
    reportUrl: run.reportUrl,
    exitCode: run.exitCode,
  };
}

/* ------------------------------------------------------------ run execution */

/**
 * Parse a single line of the `list` reporter into a per-test status update.
 * Handles both the TTY glyph form (`✓ 1 …`) and the non-TTY TAP form
 * (`ok 1 …` / `not ok 2 …`). Best-effort — the authoritative final numbers
 * come from results.json.
 */
function parseTestLine(run, line) {
  const m = line.match(/^\s*(not ok|ok|✓|✔|✘|✗|✖|‼|±|-)\s+(\d+)\s+(.*?)\s*$/u);
  if (!m) return;
  const token = m[1];
  const index = Number(m[2]);
  let title = m[3];
  const status =
    token === 'ok' || token === '✓' || token === '✔' ? 'passed'
      : token === '-' ? 'skipped'
      : token === '±' ? 'flaky'
      : 'failed'; // 'not ok' | ✘ | ✗ | ✖ | ‼

  let duration = null;
  const dm = title.match(/\(([\d.]+\s*m?s)\)\s*$/);
  if (dm) {
    duration = dm[1];
    title = title.slice(0, dm.index).trim();
  }
  const test = { index, title, status, duration };
  run.tests.push(test);
  broadcast(run, 'test', test);
}

async function readSummary(runDir) {
  try {
    const raw = await fsp.readFile(path.join(runDir, 'results.json'), 'utf8');
    const json = JSON.parse(raw);
    const s = json.stats ?? {};
    return {
      expected: s.expected ?? 0,
      unexpected: s.unexpected ?? 0,
      skipped: s.skipped ?? 0,
      flaky: s.flaky ?? 0,
      durationMs: Math.round(s.duration ?? 0),
    };
  } catch {
    return null;
  }
}

async function pruneOldReports() {
  try {
    const entries = await fsp.readdir(RUNS_DIR, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(RUNS_DIR, e.name));
    const withTime = await Promise.all(
      dirs.map(async (d) => ({ d, t: (await fsp.stat(d)).mtimeMs })),
    );
    withTime.sort((a, b) => b.t - a.t);
    for (const { d } of withTime.slice(CONFIG.maxReports)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }
}

/** Count the tests in a group with `--list` (no browsers, no network). */
function listCount(groupId) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [PW_CLI, 'test', ...GROUPS[groupId].args, '--list'],
      { cwd: ROOT, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => {
      const m = out.match(/Total:\s+(\d+)\s+tests?/i);
      resolve(m ? Number(m[1]) : null);
    });
    child.on('error', () => resolve(null));
  });
}

async function refreshCounts() {
  const ids = Object.keys(GROUPS);
  const counts = await Promise.all(ids.map(listCount));
  ids.forEach((id, i) => {
    groupCounts[id] = counts[i];
  });
  console.log(
    `[runner] test counts: ${ids.map((id) => `${id}=${groupCounts[id] ?? '?'}`).join(', ')}`,
  );
}

function startRun(group, ip) {
  const id = crypto.randomUUID();
  const runDir = path.join(RUNS_DIR, id);
  const reportDir = path.join(runDir, 'report');
  fs.mkdirSync(reportDir, { recursive: true });

  /** @type {Run} */
  const run = {
    id,
    group,
    status: 'running',
    startedAt: nowIso(),
    finishedAt: null,
    ip,
    events: [],
    tests: [],
    summary: null,
    reportUrl: null,
    exitCode: null,
    runDir,
  };
  runs.set(id, run);
  subscribers.set(id, new Set());
  activeRunId = id;

  const args = [PW_CLI, 'test', ...GROUPS[group].args, '--reporter=list,json,html'];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      PLAYWRIGHT_HTML_OPEN: 'never',
      PLAYWRIGHT_HTML_REPORT: reportDir,
      PLAYWRIGHT_HTML_OUTPUT_DIR: reportDir,
      PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(runDir, 'results.json'),
    },
  });

  broadcast(run, 'status', { status: 'running', group });
  broadcast(run, 'log', { line: `▶ Running "${group}" against ${process.env.TEST_BASE_URL ?? '(TEST_BASE_URL unset)'}` });

  // Buffer across chunks so a line split between two 'data' events isn't lost.
  let lineBuf = '';
  const onText = (buf) => {
    lineBuf += buf.toString();
    const lines = lineBuf.split(/\r?\n/);
    lineBuf = lines.pop() ?? ''; // keep the trailing partial line
    for (const line of lines) {
      if (line.trim().length) broadcast(run, 'log', { line });
      parseTestLine(run, line);
    }
  };
  child.stdout.on('data', onText);
  child.stderr.on('data', onText);
  const flushLineBuf = () => {
    if (lineBuf.trim().length) {
      broadcast(run, 'log', { line: lineBuf });
      parseTestLine(run, lineBuf);
    }
    lineBuf = '';
  };

  const timeout = setTimeout(() => {
    run.timedOut = true;
    broadcast(run, 'log', { line: `⏱ Timed out after ${CONFIG.runTimeoutMs}ms — killing run.` });
    child.kill('SIGKILL');
  }, CONFIG.runTimeoutMs);

  child.on('error', (err) => {
    clearTimeout(timeout);
    finishRun(run, 'error', null, `Failed to start runner: ${err.message}`);
  });

  child.on('close', async (code) => {
    clearTimeout(timeout);
    flushLineBuf();
    run.exitCode = code;
    const summary = await readSummary(runDir);
    run.summary = summary;
    if (fs.existsSync(path.join(reportDir, 'index.html'))) {
      run.reportUrl = `/reports/${id}/index.html`;
    }
    let status;
    if (run.timedOut) status = 'timedout';
    else if (code === 0) status = 'passed';
    else status = 'failed';
    finishRun(run, status);
    await pruneOldReports();
  });

  return run;
}

function finishRun(run, status, _summary, errorLine) {
  run.status = status;
  run.finishedAt = nowIso();
  if (errorLine) broadcast(run, 'log', { line: `✖ ${errorLine}` });
  broadcast(run, 'done', {
    status,
    summary: run.summary,
    reportUrl: run.reportUrl,
    exitCode: run.exitCode,
  });
  if (activeRunId === run.id) activeRunId = null;
  // Close any open SSE connections shortly after the done event flushes.
  const subs = subscribers.get(run.id);
  if (subs) {
    setTimeout(() => {
      for (const res of subs) res.end();
      subs.clear();
    }, 250);
  }
}

/* ------------------------------------------------------------ static report */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
};

function serveReport(req, res, runId, rest, origin) {
  const baseDir = path.join(RUNS_DIR, runId, 'report');
  const target = path.normalize(path.join(baseDir, rest || 'index.html'));
  // Path-traversal guard: resolved path must stay inside the report dir.
  if (!target.startsWith(baseDir)) {
    return sendJson(res, 403, { error: 'Forbidden' }, origin);
  }
  fs.stat(target, (err, stat) => {
    let file = target;
    if (!err && stat.isDirectory()) file = path.join(target, 'index.html');
    fs.readFile(file, (readErr, data) => {
      if (readErr) return sendJson(res, 404, { error: 'Not found' }, origin);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        ...corsHeaders(origin),
      });
      res.end(data);
    });
  });
}

/* ----------------------------------------------------------------- routing */

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4096) req.destroy(); // tiny body only
    });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  // Health
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, active: activeRunId }, origin);
  }

  // Groups (allowlist, public view) with test counts.
  if (req.method === 'GET' && pathname === '/api/groups') {
    const groups = publicGroups().map((g) => ({
      ...g,
      count: groupCounts[g.id] ?? null,
    }));
    return sendJson(res, 200, { groups }, origin);
  }

  // Latest finished run
  if (req.method === 'GET' && pathname === '/api/latest') {
    const finished = [...runs.values()]
      .filter((r) => r.status !== 'running')
      .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
    return sendJson(res, 200, { run: finished[0] ? publicRun(finished[0]) : null }, origin);
  }

  // Run snapshot
  let m = pathname.match(/^\/api\/run\/([0-9a-f-]+)$/i);
  if (req.method === 'GET' && m) {
    const run = runs.get(m[1]);
    if (!run) return sendJson(res, 404, { error: 'Unknown run' }, origin);
    return sendJson(res, 200, { run: publicRun(run) }, origin);
  }

  // SSE stream
  m = pathname.match(/^\/api\/run\/([0-9a-f-]+)\/stream$/i);
  if (req.method === 'GET' && m) {
    const run = runs.get(m[1]);
    if (!run) return sendJson(res, 404, { error: 'Unknown run' }, origin);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...corsHeaders(origin),
    });
    res.write(`retry: 3000\n\n`);
    // Replay buffered events so late subscribers catch up.
    for (const ev of run.events) {
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    }
    if (run.status === 'running') {
      subscribers.get(run.id)?.add(res);
      req.on('close', () => subscribers.get(run.id)?.delete(res));
    } else {
      res.end(); // already finished; replay was enough
    }
    return;
  }

  // Static report assets
  m = pathname.match(/^\/reports\/([0-9a-f-]+)(?:\/(.*))?$/i);
  if (req.method === 'GET' && m) {
    return serveReport(req, res, m[1], m[2] ?? '', origin);
  }

  // Trigger a run
  if (req.method === 'POST' && pathname === '/api/run') {
    if (!origin || !CONFIG.allowedOrigins.includes(origin)) {
      return sendJson(res, 403, { error: 'Origin not allowed' }, origin);
    }
    if (activeRunId) {
      return sendJson(res, 409, { error: 'A run is already in progress', activeRunId }, origin);
    }
    const body = await readBody(req).then((b) => {
      try { return JSON.parse(b || '{}'); } catch { return null; }
    });
    if (!body || typeof body.group !== 'string' || !Object.hasOwn(GROUPS, body.group)) {
      return sendJson(res, 400, { error: 'Unknown or missing group' }, origin);
    }

    // Rate limit (per-IP + global, sliding 1h window).
    const ip = clientIp(req);
    const ipArr = pruneWindow(ipHits.get(ip) ?? []);
    globalHits = pruneWindow(globalHits);
    if (ipArr.length >= CONFIG.perIpPerHour) {
      return sendJson(res, 429, { error: 'Rate limit reached for your address. Try again later.' }, origin);
    }
    if (globalHits.length >= CONFIG.globalPerHour) {
      return sendJson(res, 429, { error: 'The lab is busy right now. Try again later.' }, origin);
    }
    ipArr.push(Date.now());
    ipHits.set(ip, ipArr);
    globalHits.push(Date.now());

    const run = startRun(body.group, ip);
    return sendJson(res, 202, { runId: run.id }, origin);
  }

  return sendJson(res, 404, { error: 'Not found' }, origin);
});

fs.mkdirSync(RUNS_DIR, { recursive: true });
server.listen(CONFIG.port, () => {
  console.log(`[runner] listening on :${CONFIG.port}`);
  console.log(`[runner] allowed origins: ${CONFIG.allowedOrigins.join(', ') || '(none)'}`);
  console.log(`[runner] target: ${process.env.TEST_BASE_URL ?? '(TEST_BASE_URL unset)'}`);
  console.log(`[runner] playwright cli: ${PW_CLI}`);
});

// Compute test counts in the background so /api/groups can show them.
refreshCounts().catch((err) => console.warn('[runner] count refresh failed:', err.message));

/** @typedef {{id:string,group:string,status:string,startedAt:string,finishedAt:string|null,ip:string,events:any[],tests:any[],summary:any,reportUrl:string|null,exitCode:number|null,runDir:string,timedOut?:boolean}} Run */
