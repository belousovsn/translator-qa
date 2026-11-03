import assert from 'node:assert/strict';
import { decide } from '../lib/claude.mjs';

const now = 1_800_000_000;
const probe = (info, ok = true) => ({ ok, text: ok ? 'ok' : 'Not logged in', info });

assert.equal(decide(probe(null), { now }).action, 'run');
assert.equal(decide(probe(null, false), { now }).action, 'skip');
assert.equal(decide(probe({ status: 'allowed', utilization: 0.2 }), { now }).action, 'run');
assert.equal(decide(probe({ status: 'allowed', utilization: 20 }), { now }).action, 'run');
assert.equal(decide(probe({ status: 'allowed' }), { now }).action, 'run');

const wait = decide(probe({ status: 'allowed_warning', utilization: 0.7, resetsAt: now + 3600 }), { now });
assert.equal(wait.action, 'wait');
assert.equal(wait.until, now + 3600 + 300);
assert.equal(decide(probe({ status: 'rejected', resetsAt: now + 2 * 3600 }), { now }).action, 'wait');

// A reset days away is the weekly window: waiting in the job makes no sense.
assert.equal(decide(probe({ status: 'rejected', resetsAt: now + 3 * 86400 }), { now }).action, 'skip');
// The shape a subscription token actually returns (03.11.2026).
const windows = (five, week) => ({
  status: 'allowed',
  resetsAt: now + 3600,
  rateLimitType: 'five_hour',
  unifiedWindows: { five_hour: { utilization: five, resetsAt: now + 3600 }, seven_day: { utilization: week, resetsAt: now + 4 * 86400 } },
});
const fresh = decide(probe(windows(0.03, 0.1)), { now });
assert.equal(fresh.action, 'run');
assert.equal(fresh.reason, '5 ч занято 3%, неделя 10%');
assert.equal(decide(probe(windows(0.6, 0.1)), { now }).until, now + 3600 + 300);
assert.equal(decide(probe(windows(0.1, 0.95)), { now }).action, 'skip');
console.log('decide ok');
