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

const asShare = (u) => (u == null ? null : u > 1 ? u / 100 : u);
const pct = (s) => `${Math.round(s * 100)}%`;

/**
 * Decides whether to start now. The subscription reports two windows in
 * `unifiedWindows`: five_hour and seven_day, each with a 0–1 `utilization`
 * and `resetsAt`. Older events carry only top-level `utilization`/`resetsAt`.
 *   run  — under `threshold` of the 5-hour window used, or nothing reported
 *   wait — over it or rejected, and the window resets within 6 hours
 *   skip — the week is nearly spent, or the reset is days away
 */
export function decide(probe, { threshold = 0.5, weekly = 0.9, now = Date.now() / 1000 } = {}) {
  const info = probe.info;
  if (!info) {
    return probe.ok
      ? { action: 'run', reason: 'лимит не сообщён, проба прошла' }
      : { action: 'skip', reason: `проба не прошла: ${probe.text.slice(0, 160)}` };
  }
  const five = info.unifiedWindows?.five_hour ?? {};
  const week = info.unifiedWindows?.seven_day ?? {};
  const share = asShare(five.utilization ?? info.utilization);
  const weekShare = asShare(week.utilization);
  const resetsAt = five.resetsAt ?? info.resetsAt;
  const reason = [
    share == null ? `статус ${info.status}` : `5 ч занято ${pct(share)}`,
    weekShare == null ? null : `неделя ${pct(weekShare)}`,
  ]
    .filter(Boolean)
    .join(', ');

  if (weekShare != null && weekShare >= weekly) {
    return { action: 'skip', reason: `недельный лимит почти выбран, ${reason}`, info };
  }
  const busy = info.status === 'rejected' || (share != null && share >= threshold);
  if (!busy) return { action: 'run', reason, info };
  const resetIn = resetsAt ? resetsAt - now : null;
  if (resetIn != null && resetIn <= 6 * HOUR) return { action: 'wait', until: resetsAt + 300, reason, info };
  return { action: 'skip', reason: `лимит сбросится нескоро, похоже на недельный, ${reason}`, info };
}
