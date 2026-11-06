import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addItem, loadKnowledge, saveKnowledge } from '../lib/knowledge.mjs';
import { summarize } from '../lib/notify.mjs';
import { pendingFindings, prunableRuns, renderSite } from '../lib/site.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-p-'));
const persona = { id: 'guest-ru-phone', name: 'Аня, гость', device: 'Pixel 7', locale: 'ru-RU', account: 'guest' };
const writeRun = (stamp, findings) => {
  const d = path.join(dir, 'runs', persona.id, stamp);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ startedAt: stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'), status: 'ok' }));
  writeFileSync(path.join(d, 'report.json'), JSON.stringify({ summary: 's', goals: [], steps: [], findings }));
  return `runs/${persona.id}/${stamp}`;
};

// Four runs, newest last. Only the oldest has something undecided.
const oldest = writeRun('2026-11-01T10-00-00-000Z', [{ id: 'F1', severity: 'low', observed: 'обрезано название' }]);
const old = writeRun('2026-11-02T10-00-00-000Z', [{ id: 'F1', severity: 'high', observed: 'решено' }]);
writeRun('2026-11-03T10-00-00-000Z', [{ id: 'F1', severity: 'medium', observed: 'разборщик пропустил' }]);
writeRun('2026-11-04T10-00-00-000Z', []);

const k = loadKnowledge(dir);
addItem(k, { kind: 'issue', finding: { id: 'F1', observed: 'решено' }, runRel: old, persona: persona.id, by: 'triage', issue: { number: 1, url: 'u', state: 'open' } });
addItem(k, { kind: 'skipped', finding: { id: 'F1', observed: 'разборщик пропустил' }, runRel: `runs/${persona.id}/2026-11-03T10-00-00-000Z`, persona: persona.id, by: 'triage', reason: 'лимит в 5 задач' });
saveKnowledge(dir, k);

// A triage skip still waits; a triage issue does not. Worst first.
const pending = pendingFindings(dir, [persona]);
assert.deepEqual(pending.map((p) => p.finding.observed), ['разборщик пропустил', 'обрезано название']);

// The run with the undecided finding survives pruning; the decided old one goes.
assert.deepEqual(prunableRuns(dir, persona.id).map((r) => r.rel), [old]);

renderSite(dir, [persona]);
const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
assert.match(html, /Ждут решения \(2\)/);
assert.match(html, /Разборщик предлагает не заводить: лимит в 5 задач/);
assert.match(html, new RegExp(`data-decide="skipped" data-run-rel="${oldest}"`));

// Sergey's own skip ends the wait.
const k2 = loadKnowledge(dir);
addItem(k2, { kind: 'skipped', finding: { id: 'F1', observed: 'обрезано название' }, runRel: oldest, persona: persona.id });
saveKnowledge(dir, k2);
assert.equal(pendingFindings(dir, [persona]).length, 1);
assert.deepEqual(prunableRuns(dir, persona.id).map((r) => r.rel), [old, oldest]);

const text = summarize([], { pageUrl: 'https://qa.memdecks.com/agents', pending: 3 });
assert.match(text, /Ждут твоего решения: 3\n {2}https:\/\/qa\.memdecks\.com\/agents\/#pending/);
console.log('pending ok');
