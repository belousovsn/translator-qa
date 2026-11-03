#!/usr/bin/env node
// Small API behind the agents page (#747). nginx puts it under /agents/api/
// with the same basic auth as the page, so it trusts every request it gets.
//
//   GET  /agents/api/status   what the runner is doing and what waits in the queue
//   POST /agents/api/run      {"personas": ["guest-ru-phone"]}  queue a manual run
//
// It only writes a job file and wakes the worker; the run itself goes through
// run.sh like every other run, under the same lock.

import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunnable, loadPersonas } from './lib/personas.mjs';
import { enqueueManual, readManual, readQueue } from './lib/planner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.QA_AGENTS_HOME ?? path.join(here, '.data'));
const QUEUE = process.env.QA_AGENTS_QUEUE ?? path.join(DATA, '..', 'queue');
const PORT = Number(process.env.QA_AGENTS_API_PORT ?? 8791);
const WORKER_LOG = process.env.QA_AGENTS_WORKER_LOG ?? path.join(DATA, '..', 'worker.log');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function status() {
  let s = { state: 'idle' };
  try {
    s = JSON.parse(readFileSync(path.join(DATA, 'status.json'), 'utf8'));
  } catch {}
  if (s.state !== 'idle' && !(s.pid && alive(s.pid))) s = { state: 'idle' };
  return {
    ...s,
    queue: [
      ...readManual(QUEUE).map((j) => ({ kind: 'manual', file: j.file, personas: j.personas, at: j.at })),
      ...readQueue(QUEUE).map((j) => ({ kind: 'deploy', file: j.file, sha: j.sha })),
    ].filter((j) => !(s.jobs ?? []).includes(j.file)),
  };
}

function wakeWorker() {
  const out = openSync(WORKER_LOG, 'a');
  spawn(path.join(here, 'run.sh'), ['--from-queue'], { detached: true, stdio: ['ignore', out, out] }).unref();
}

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/agents/api/status') return send(res, 200, status());
    if (req.method === 'POST' && url.pathname === '/agents/api/run') {
      // A cross-site form cannot set this header, so a page elsewhere cannot
      // start runs with the browser's saved password.
      if (req.headers['x-qa-agents'] !== '1') return send(res, 403, { error: 'missing header' });
      let ids;
      try {
        ids = JSON.parse(await readBody(req)).personas;
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const personas = loadPersonas(path.join(here, 'personas'));
      const runnable = new Set(personas.filter(isRunnable).map((p) => p.id));
      if (!Array.isArray(ids) || !ids.length || !ids.every((id) => runnable.has(id))) {
        return send(res, 400, { error: 'unknown or blocked persona' });
      }
      const job = enqueueManual(QUEUE, [...new Set(ids)]);
      wakeWorker();
      return send(res, 202, { queued: job, status: status() });
    }
    send(res, 404, { error: 'not found' });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`qa-agents api on 127.0.0.1:${PORT}`));

if (!existsSync(QUEUE)) console.log(`queue folder ${QUEUE} does not exist yet`);
