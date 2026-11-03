import assert from 'node:assert/strict';
import { summarize } from '../lib/notify.mjs';
import { isShown, mergeFindings } from '../lib/verify.mjs';

const report = {
  goals: [{ goal: 'g', reached: true }],
  findings: [
    { id: 'F1', step: 18, severity: 'high', observed: 'квиз завис', screenshot: 'finding-F1.png' },
    { id: 'F2', step: 1, severity: 'low', observed: 'подвал на английском' },
    { id: 'F3', step: 4, severity: 'low', observed: 'что-то' },
  ],
};
const verify = {
  findings: [
    { id: 'F1', verdict: 'reworded', severity: 'medium', observed: 'заставка держится 14 с', reason: 'варианты есть', where: { screen: 'Игры → WordBase Quiz' } },
    { id: 'F2', verdict: 'confirmed', where: { screen: 'Главная', element: 'подвал' } },
    { id: 'F3', verdict: 'rejected', reason: 'на снимке всё на месте' },
  ],
  missed: [{ severity: 'low', rule: 'R1', observed: 'подписи noun на английском', where: { screen: 'Игры → WordBase Quiz' } }],
};

const all = mergeFindings(report, verify);
assert.equal(all.length, 4);
assert.equal(all[0].observed, 'заставка держится 14 с');
assert.equal(all[0].originalObserved, 'квиз завис');
assert.equal(all[0].severity, 'medium');
assert.equal(all[1].observed, 'подвал на английском');
assert.equal(all[3].id, 'V1');
assert.deepEqual(all.filter(isShown).map((f) => f.id), ['F1', 'F2', 'V1']);
assert.equal(mergeFindings(report, null).every(isShown), true);

const text = summarize(
  [{ persona: { name: 'Аня' }, meta: {}, report, verify, rel: 'runs/guest-ru-phone/2026-11-03T20-00-33-855Z' }],
  { pageUrl: 'https://qa.memdecks.com/agents' },
);
assert.match(text, /находок 3, отсеяно 1/);
assert.match(text, /средне · Игры → WordBase Quiz: заставка держится 14 с\n {2}https:\/\/qa\.memdecks\.com\/agents\/#guest-ru-phone-2026-11-03T20-00-33-855Z-F1/);
assert.doesNotMatch(text, /на снимке всё на месте/);
console.log('verify ok');
