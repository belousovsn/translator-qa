// Diff mode (#747): after a deploy to test, one Claude call reads the commits
// and the diff and decides whether a user can see the change, which personas
// fit it, and where they should go first. The personas keep their own goals;
// the focus only says which part of the app to visit on the way.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MODELS, runClaude } from './claude.mjs';

const PLAN_START = '<<<PLAN';
const PLAN_END = 'PLAN>>>';

/**
 * Reads every job in the queue: several deploys in a row become one run over
 * all their commits. Jobs stay on disk until `dropJobs` after the run, so a
 * crash loses nothing and a deploy that arrives meanwhile waits for the next round.
 */
export function readQueue(queueDir) {
  if (!existsSync(queueDir)) return [];
  return readdirSync(queueDir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => ({ file: f, sha: f.match(/-([0-9a-f]+)\.txt$/)?.[1] ?? '?', text: readFileSync(path.join(queueDir, f), 'utf8') }));
}

export function dropJobs(queueDir, jobs) {
  for (const j of jobs) rmSync(path.join(queueDir, j.file), { force: true });
}

/** Keeps the combined diff within what one prompt should carry. */
export function combineJobs(jobs, maxChars = 120_000) {
  const parts = jobs.map((j) => `# Деплой ${j.sha}\n\n${j.text.trim()}`);
  let text = parts.join('\n\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n\n[дифф обрезан, всего ${text.length} символов]`;
  return { shas: jobs.map((j) => j.sha), text };
}

export function buildPlannerPrompt({ diff, personas, maxPersonas }) {
  const list = personas
    .map((p) => `- ${p.id}: ${p.name}. ${p.device}, ${p.locale}, тема ${p.colorScheme ?? 'light'}. ${p.body.split('\n').find((l) => l.trim()) ?? ''}`)
    .join('\n');
  return `Ты планируешь проверку приложения MemDecks после деплоя на тестовый стенд. Приложение учит словам через колоды карточек и игры. Вкладки: Игры, Коллекция, Колоды, Переводчик, Профиль. Игры открываются во фрейме с отдельных адресов. Есть онбординг для гостя и вход по почте.

Ниже коммиты и дифф этого деплоя. Реши три вещи.

1. Видно ли изменение пользователю в браузере. Если поменялись только тесты, документация, скрипты, CI, серверная логика без влияния на ответы или данные контента, которых нет в интерфейсе, ставь "ui": false.
2. Куда пользователю идти, чтобы встретить изменение. Пиши словами интерфейса: вкладка, экран, действие. Не пиши имена файлов и функций. Если изменение задевает соседние экраны (общий компонент, стили, перевод интерфейса, данные), назови и их: ошибки чаще всего живут на стыках.
3. Каких персонажей пустить, не больше ${maxPersonas}. Выбирай тех, чьё устройство, язык и тема лучше всего показывают изменение. Можно только из списка:

${list}

Ответь коротко по-русски и в конце выведи ровно один JSON между строками ${PLAN_START} и ${PLAN_END}:

${PLAN_START}
{
  "ui": true,
  "summary": "одно предложение: что поменялось для пользователя",
  "focus": [
    { "area": "Коллекция → карточка слова", "how": "открыть любую карточку и перевернуть", "why": "поменялась вёрстка обратной стороны" }
  ],
  "personas": ["guest-ru-phone"],
  "reason": "почему эти персонажи"
}
${PLAN_END}

Коммиты и дифф:

${diff}`;
}

export function extractPlan(text) {
  const start = text.lastIndexOf(PLAN_START);
  const end = text.lastIndexOf(PLAN_END);
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start + PLAN_START.length, end).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
}

/** Runs the planner. Returns the plan with only known, runnable persona ids kept. */
export async function planDeploy({ diff, personas, maxPersonas = 2, logFile }) {
  const r = await runClaude({
    prompt: buildPlannerPrompt({ diff, personas, maxPersonas }),
    model: MODELS.planner,
    cwd: process.cwd(),
    logFile,
    timeoutMs: 10 * 60 * 1000,
    args: ['--tools', '', '--strict-mcp-config', '--max-turns', '3'],
  });
  const plan = extractPlan(r.text);
  if (!plan) return { error: (r.text || r.stderr).slice(0, 400) };
  const ids = new Set(personas.map((p) => p.id));
  plan.personas = (plan.personas ?? []).filter((id) => ids.has(id)).slice(0, maxPersonas);
  if (plan.ui && !plan.personas.length) plan.personas = [personas[0].id];
  return plan;
}

/** The section the persona prompt gets in diff mode. */
export function describeFocus(plan) {
  if (!plan?.focus?.length) return '';
  const items = plan.focus.map((f) => `- ${f.area}: ${f.how}. ${f.why ? `Что поменялось: ${f.why}.` : ''}`).join('\n');
  return `# Что поменялось в этом деплое

${plan.summary ?? ''}

Сходи в эти места по ходу своих целей, лучше в первой половине прогона. Смотри и на соседние экраны: стыки ломаются чаще всего. Свою роль не бросай: заходи туда так, как зашёл бы этот человек.

${items}`;
}
