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
console.log('decide ok');
