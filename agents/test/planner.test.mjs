import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { combineJobs, describeFocus, dropJobs, extractPlan, readQueue } from '../lib/planner.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'qa-queue-'));
writeFileSync(path.join(dir, '20261104T100000Z-aaaaaaaaaaaa.txt'), 'first');
writeFileSync(path.join(dir, '20261104T100500Z-bbbbbbbbbbbb.txt'), 'second');
writeFileSync(path.join(dir, '20261104T101000Z-cccccccccccc.txt.part'), 'still arriving');
const jobs = readQueue(dir);
assert.deepEqual(jobs.map((j) => j.sha), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
const { shas, text } = combineJobs(jobs);
assert.equal(shas.length, 2);
assert.match(text, /# Деплой aaaaaaaaaaaa\n\nfirst\n\n# Деплой bbbbbbbbbbbb\n\nsecond/);
assert.match(combineJobs(jobs, 10).text, /дифф обрезан/);
dropJobs(dir, jobs);
assert.deepEqual(readdirSync(dir), ['20261104T101000Z-cccccccccccc.txt.part']);

const plan = extractPlan('думаю…\n<<<PLAN\n```json\n{"ui": true, "summary": "s", "focus": [{"area": "Коллекция", "how": "открыть", "why": "вёрстка"}], "personas": ["x"]}\n```\nPLAN>>>');
assert.equal(plan.ui, true);
assert.match(describeFocus(plan), /- Коллекция: открыть\. Что поменялось: вёрстка\./);
assert.equal(describeFocus({ focus: [] }), '');
assert.equal(extractPlan('нет плана'), null);
console.log('planner ok');
