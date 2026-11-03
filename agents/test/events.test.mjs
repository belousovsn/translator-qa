import assert from 'node:assert/strict';
import { EVENTS, describePlan, planEvents } from '../lib/events.mjs';

// Same seed, same plan: a run can be repeated from its report.
assert.deepEqual(planEvents(42), planEvents(42));

// Over many seeds every count 0..3 and every event kind shows up, and steps stay in range.
const counts = new Set();
const kinds = new Set();
for (let s = 1; s < 2000; s += 1) {
  const p = planEvents(s);
  counts.add(p.events.length);
  for (const e of p.events) {
    kinds.add(e.kind);
    assert.ok(e.afterStep >= 2 && e.afterStep <= 13, `step ${e.afterStep}`);
  }
  const steps = p.events.map((e) => e.afterStep);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
}
assert.deepEqual([...counts].sort(), [0, 1, 2, 3]);
assert.deepEqual([...kinds].sort(), Object.keys(EVENTS).sort());

assert.match(describePlan({ seed: 1, events: [] }), /событий среды нет/);
assert.match(describePlan({ seed: 1, events: [{ kind: 'offline', afterStep: 4 }] }), /После шага 4: пропал интернет/);
console.log('events ok');
