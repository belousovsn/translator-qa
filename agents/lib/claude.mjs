import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export const MODELS = {
  persona: process.env.QA_AGENTS_PERSONA_MODEL ?? 'claude-sonnet-5-5',
  probe: process.env.QA_AGENTS_PROBE_MODEL ?? 'claude-haiku-5-5',
};

const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';

/**
 * Runs `claude -p` with stream-json output. Every line goes to `logFile` when
 * given. Returns the final result text plus every rate-limit event seen, which
 * is how a subscription session learns its usage and reset time (#747).
 */
export function runClaude({ prompt, model, cwd, args = [], logFile, env = {}, timeoutMs }) {
  return new Promise((resolve) => {
    const cliArgs = ['-p', prompt, '--model', model, '--output-format', 'stream-json', '--verbose', ...args];
    // A .mjs CLAUDE_BIN is a local stand-in used to test the runner without a subscription.
    const [cmd, argv] = /\.m?js$/.test(CLAUDE) ? [process.execPath, [CLAUDE, ...cliArgs]] : [CLAUDE, cliArgs];
    const child = spawn(
      cmd,
      argv,
      {
        cwd,
        env: {
          ...process.env,
          // Wait out a usage limit inside the run instead of failing the persona.
          CLAUDE_CODE_RETRY_WATCHDOG: '1',
          CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: '600000',
          CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: String(5.5 * 3600 * 1000),
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const log = logFile ? createWriteStream(logFile) : null;
    const rateLimits = [];
    let result = null;
    let buf = '';
    let stderr = '';
    const onLine = (line) => {
      if (!line.trim()) return;
      log?.write(`${line}\n`);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'rate_limit_event') rateLimits.push({ ...msg.rate_limit_info, at: Date.now() });
      if (msg.type === 'result') result = msg;
    };
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      onLine(buf);
      log?.end();
      resolve({
        code,
        text: result?.result ?? '',
        isError: result?.is_error ?? code !== 0,
        numTurns: result?.num_turns ?? null,
        durationMs: result?.duration_ms ?? null,
        rateLimits,
        stderr: stderr.slice(-2000),
      });
    });
  });
}

/** One cheap call that reports the current usage window. */
export async function probeLimit() {
  const r = await runClaude({
    prompt: 'Answer with one word: ok',
    model: MODELS.probe,
    cwd: process.cwd(),
    args: ['--tools', '', '--strict-mcp-config'],
    // A probe must not sit in a usage-limit wait: it is there to find out about one.
    env: { CLAUDE_CODE_RETRY_WATCHDOG: '0' },
    timeoutMs: 120_000,
  });
  const last = r.rateLimits.at(-1) ?? null;
  return { ok: !r.isError, text: r.text, info: last };
}

const HOUR = 3600;

/**
 * Decides whether to start now. `utilization` may come as a 0–1 share or a
 * percent; both read the same here.
 *   run  — under half of the window used, or nothing reported
 *   wait — over half used or rejected, and the window resets within 6 hours
 *   skip — the reset is further away, which means the weekly limit
 */
export function decide(probe, { threshold = 0.5, now = Date.now() / 1000 } = {}) {
  const info = probe.info;
  if (!info) {
    return probe.ok
      ? { action: 'run', reason: 'лимит не сообщён, проба прошла' }
      : { action: 'skip', reason: `проба не прошла: ${probe.text.slice(0, 160)}` };
  }
  const share = info.utilization == null ? null : info.utilization > 1 ? info.utilization / 100 : info.utilization;
  const busy = info.status === 'rejected' || (share != null && share >= threshold);
  if (!busy) return { action: 'run', reason: share == null ? `статус ${info.status}` : `занято ${Math.round(share * 100)}%`, info };
  const resetIn = info.resetsAt ? info.resetsAt - now : null;
  if (resetIn != null && resetIn <= 6 * HOUR) {
    return { action: 'wait', until: info.resetsAt + 300, reason: share == null ? `статус ${info.status}` : `занято ${Math.round(share * 100)}%`, info };
  }
  return { action: 'skip', reason: 'лимит сбросится нескоро, похоже на недельный', info };
}
