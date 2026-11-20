import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addItem, describeKnowledge, loadKnowledge, saveKnowledge } from '../lib/knowledge.mjs';
import { applyTriage, buildTriagePrompt, collectFindings, describeTriage, extractTriage, formatBoard, issueBody, MAX_NEW_ISSUES, scrub } from '../lib/triage.mjs';
import { splitMessage } from '../lib/notify.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-t-'));
const persona = (id, name) => ({ id, name, device: 'Pixel 7', locale: 'ru-RU' });
const run = (id, name, findings, verify) => ({
  persona: persona(id, name),
  rel: `runs/${id}/2026-11-04T00-55-04-851Z`,
  meta: { startedAt: '2026-11-04T00:55:04.851Z', plan: { events: [{ kind: 'away' }], games: { mode: 'mock' } } },
  report: { findings },
  verify,
});
const footer = { id: 'F2', severity: 'low', rule: 'R1', observed: 'подвал на английском', where: { screen: 'Главная', element: 'подвал' } };
const runs = [
  run('guest-then-signin', 'Лиана', [footer, { id: 'F1', severity: 'high', observed: 'лимит на первом слове' }, { id: 'F3', severity: 'low', observed: 'выдумано' }], {
    findings: [{ id: 'F3', verdict: 'rejected', reason: 'на снимке есть' }],
    missed: [{ severity: 'low', observed: 'Getting things ready… на английском' }],
  }),
  run('hy-veteran', 'Сергей', [{ ...footer, id: 'F3' }, { id: 'F1', severity: 'high', observed: 'сессия слетает' }, { id: 'F4', observed: 'известное' }], {
    findings: [{ id: 'F4', verdict: 'known', known: 'K9' }],
  }),
];

// Decided findings, rejected ones and known ones are not triaged.
const k = loadKnowledge(dir);
addItem(k, { kind: 'accepted', finding: { id: 'F1', observed: 'сессия слетает' }, runRel: runs[1].rel, persona: 'hy-veteran' });
saveKnowledge(dir, k);
const items = collectFindings(runs, loadKnowledge(dir));
assert.deepEqual(items.map((i) => i.key), ['guest-then-signin/F2', 'guest-then-signin/F1', 'guest-then-signin/V1', 'hy-veteran/F3']);

const board = {
  issues: [
    { number: 812, title: 'Квиз висит на заставке', state: 'open', column: 'On test', labels: ['bug', 'game'], url: 'https://github.com/o/r/issues/812', body: 'Заставка\nдержится долго' },
    { number: 700, title: 'Старое', state: 'closed', stateReason: 'not_planned', closedAt: '2026-10-01T00:00:00Z', column: 'архив', labels: [], url: 'u700', body: '' },
  ],
  labels: ['bug', 'UI', 'game'],
};
const md = formatBoard(board);
assert.match(md, /## #812 · открыта · On test · bug, game\nКвиз висит на заставке\nЗаставка держится долго/);
assert.match(md, /## #700 · закрыта \(не будем делать\) 2026-10-01 · архив/);

const prompt = buildTriagePrompt({ items, k: loadKnowledge(dir), labels: board.labels, boardFile: 'triage/x/board.md' });
assert.match(prompt, /triage\/x\/board\.md/);
assert.match(prompt, /"key": "guest-then-signin\/V1"/);
assert.match(prompt, /события среды: away; игры: мок/);
assert.match(prompt, /K1 · Сергей: норма · сессия слетает/);
assert.match(prompt, /только из этого списка: bug, UI, game/);

const answer = extractTriage(`думаю…\n<<<TRIAGE\n${JSON.stringify({
  decisions: [
    { findings: ['guest-then-signin/F2', 'hy-veteran/F3', 'guest-then-signin/V1'], action: 'create', title: 'Английские тексты в русском интерфейсе', problem: 'Подвал и строка загрузки на английском.', expected: 'Всё на русском.', labels: ['bug', 'UI', 'выдуманный'], reason: 'на доске нет' },
    { findings: ['guest-then-signin/F1'], action: 'duplicate', issue: 812, stillVisible: true, reason: 'та же проблема' },
    { findings: ['nobody/F9'], action: 'skip', reason: 'нет такого ключа' },
  ],
})}\nTRIAGE>>>`);
assert.equal(answer.decisions.length, 3);
assert.equal(extractTriage('нет ответа'), null);

const filed = [];
const gh = { createIssue: async (i) => (filed.push(i), { number: 901, html_url: 'https://github.com/o/r/issues/901', state: 'open' }) };
const out = await applyTriage({ answer, items, board, gh, dataDir: dir, pageUrl: 'https://qa.memdecks.com/agents', secrets: ['s3cret-pass'] });
assert.equal(filed.length, 1);
assert.equal(filed[0].title, 'QA-агент: Английские тексты в русском интерфейсе');
assert.deepEqual(filed[0].labels, ['bug', 'UI'], 'only labels that exist');
assert.match(filed[0].body, /\*\*Что не так:\*\* Подвал и строка загрузки на английском\./);
assert.match(filed[0].body, /«Лиана» \(Pixel 7, ru-RU\), 2026-11-04: подвал на английском \[скриншот и трейс\]\(https:\/\/qa\.memdecks\.com\/agents\/#guest-then-signin-2026-11-04T00-55-04-851Z-F2\)/);
assert.match(filed[0].body, /«Сергей»/);
assert.deepEqual(out.applied.map((a) => [a.action, a.issue?.number]), [['create', 901], ['duplicate', 812]]);
assert.equal(out.applied[1].stillVisible, true);
assert.deepEqual(out.left, []);

const after = loadKnowledge(dir);
const triaged = after.items.filter((i) => i.by === 'triage');
assert.equal(triaged.length, 4, 'one item per finding');
assert.ok(triaged.every((i) => i.kind === 'issue'));
assert.match(describeKnowledge(after), /Уже в задачах[\s\S]*задача #901[\s\S]*задача #812/);
assert.deepEqual(collectFindings(runs, after), [], 'nothing is triaged twice');

const lines = describeTriage(out).join('\n');
assert.match(lines, /новая #901: Английские тексты в русском интерфейсе\n  https:\/\/github\.com\/o\/r\/issues\/901/);
assert.match(lines, /уже есть #812, в On test, но на стенде всё ещё видно: Квиз висит на заставке/);

// Skips are recorded but stay out of what the personas are told.
const dir2 = mkdtempSync(path.join(tmpdir(), 'qa-t2-'));
const skipOut = await applyTriage({
  answer: { decisions: [{ findings: ['guest-then-signin/F1'], action: 'skip', reason: 'так задумано' }, { findings: ['guest-then-signin/F2'], action: 'duplicate', issue: 999, reason: 'выдумал' }] },
  items, board, gh: { createIssue: async () => assert.fail('no issue') }, dataDir: dir2,
});
assert.deepEqual(skipOut.applied.map((a) => a.action), ['skip', 'skip']);
assert.match(skipOut.applied[1].reason, /#999, которой нет на доске/);
assert.equal(describeKnowledge(loadKnowledge(dir2)), '');
assert.deepEqual(skipOut.left, ['guest-then-signin/V1', 'hy-veteran/F3']);

// The cap on new issues per batch.
const many = Array.from({ length: MAX_NEW_ISSUES + 2 }, (_, i) => ({ key: `p/F${i}`, run: runs[0], finding: { id: `F${i}`, observed: `x${i}` } }));
let n = 0;
const capped = await applyTriage({
  answer: { decisions: many.map((m) => ({ findings: [m.key], action: 'create', title: m.finding.observed })) },
  items: many, board, gh: { createIssue: async () => ({ number: ++n, html_url: `u${n}`, state: 'open' }) }, dataDir: mkdtempSync(path.join(tmpdir(), 'qa-t3-')),
});
assert.equal(n, MAX_NEW_ISSUES);
assert.equal(capped.applied.filter((a) => a.action === 'skip').length, 2);

assert.equal(scrub('пароль s3cret-pass и токен eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', ['s3cret-pass']), 'пароль «скрыто» и токен «токен скрыт»');
assert.match(issueBody({ decision: { reason: 'r' }, items: [items[1]] }), /\*\*Что не так:\*\* лимит на первом слове/);
// Long Telegram summaries go in parts of at most 4000 characters.
const long = Array.from({ length: 300 }, (_, i) => `строка ${i} ${'x'.repeat(30)}`).join('\n');
assert.ok(splitMessage(long).length > 1);
assert.ok(splitMessage(long).every((p) => p.length <= 4000));
assert.equal(splitMessage(long).join('\n'), long);
console.log('triage ok');
