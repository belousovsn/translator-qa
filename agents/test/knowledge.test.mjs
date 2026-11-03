import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addItem, decisionFor, describeKnowledge, issueFromFinding, loadKnowledge, refreshIssues, removeItem, saveKnowledge } from '../lib/knowledge.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-k-'));
const k = loadKnowledge(dir);
assert.deepEqual(k.items, []);
assert.equal(describeKnowledge(k), '');

const footer = { id: 'F2', rule: 'R1', observed: 'подвал на английском', where: { screen: 'Главная', element: 'подвал' } };
const quiz = { id: 'F1', rule: 'R9', observed: 'заставка квиза держится 8 с', where: { screen: 'Игры → WordBase Quiz' } };
const a = addItem(k, { kind: 'accepted', finding: footer, runRel: 'runs/p/1', persona: 'p' });
const b = addItem(k, { kind: 'issue', finding: quiz, runRel: 'runs/p/1', persona: 'p', issue: { number: 812, url: 'u', state: 'open' } });
const c = addItem(k, { kind: 'not-bug', finding: { id: 'F6', observed: 'пропали две игры' }, runRel: 'runs/p/1', persona: 'p' });
assert.deepEqual([a.id, b.id, c.id], ['K1', 'K2', 'K3']);
assert.equal(decisionFor(k, 'runs/p/1', 'F1').id, 'K2');
assert.equal(decisionFor(k, 'runs/p/2', 'F1'), null);

const persona = describeKnowledge(k);
assert.match(persona, /Решено, что это норма[\s\S]*\*\*K1\.\*\* Главная · подвал: подвал на английском \(R1\)/);
assert.match(persona, /Уже в задачах[\s\S]*K2[\s\S]*задача #812/);
assert.doesNotMatch(persona, /K3/, 'the persona does not see agent mistakes');
assert.match(describeKnowledge(k, { forVerifier: true }), /Ошибки агентов в прошлом[\s\S]*K3/);

saveKnowledge(dir, k);
const changed = await refreshIssues(dir, { configured: true, getIssue: async (n) => ({ number: n, state: 'closed' }) });
assert.equal(changed, 1);
const reloaded = loadKnowledge(dir);
assert.match(describeKnowledge(reloaded), /Исправлено, проверь заново[\s\S]*K2[\s\S]*была задача #812/);
removeItem(reloaded, 'K1');
assert.deepEqual(reloaded.items.map((i) => i.id), ['K2', 'K3']);
assert.equal(addItem(reloaded, { kind: 'accepted', finding: footer, runRel: 'r', persona: 'p' }).id, 'K4', 'ids are never reused');

const issue = issueFromFinding({
  finding: { ...quiz, expected: 'вопрос сразу' },
  persona: { name: 'Аня', device: 'Pixel 7', locale: 'ru-RU' },
  runRel: 'runs/guest-ru-phone/2026-11-03T22-19-37-150Z',
  pageUrl: 'https://qa.memdecks.com/agents',
});
assert.equal(issue.title, 'QA-агент: Игры → WordBase Quiz: заставка квиза держится 8 с');
assert.deepEqual(issue.labels, ['bug', 'game']);
assert.match(issue.body, /https:\/\/qa\.memdecks\.com\/agents\/#guest-ru-phone-2026-11-03T22-19-37-150Z-F1/);
assert.deepEqual(issueFromFinding({ finding: footer, persona: { name: 'x' }, runRel: 'runs/p/1' }).labels, ['bug', 'UI']);
console.log('knowledge ok');
