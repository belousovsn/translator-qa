// What Sergey decided about past findings (#747). Lives in the data folder,
// not the repo: decisions are made on the page and change between runs.
//
//   issue    — a bug, filed on GitHub. While the issue is open the agents treat
//              it as known; once it is closed they look again, and a repeat is
//              reported as "returned".
//   accepted — how the app is meant to be. Never reported again.
//   not-bug  — the agents were wrong. Shown to the verifier as a lesson.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DECISIONS = { issue: 'в задаче', accepted: 'норма', 'not-bug': 'не баг' };

const file = (dataDir) => path.join(dataDir, 'knowledge.json');

export function loadKnowledge(dataDir) {
  try {
    return JSON.parse(readFileSync(file(dataDir), 'utf8'));
  } catch {
    return { items: [] };
  }
}

export function saveKnowledge(dataDir, k) {
  const tmp = `${file(dataDir)}.part`;
  writeFileSync(tmp, JSON.stringify(k, null, 2));
  renameSync(tmp, file(dataDir));
}

const nextId = (k) => `K${k.items.reduce((m, i) => Math.max(m, Number(i.id.slice(1)) || 0), 0) + 1}`;

/** The decision taken on one finding of one run, if any. */
export const decisionFor = (k, runRel, findingId) =>
  k.items.find((i) => i.source?.run === runRel && i.source?.finding === findingId) ?? null;

export function addItem(k, { kind, finding, runRel, persona, issue = null }) {
  const item = {
    id: nextId(k),
    kind,
    rule: finding.rule ?? null,
    observed: finding.observed,
    expected: finding.expected ?? null,
    where: finding.where ?? null,
    issue,
    source: { run: runRel, finding: finding.id, persona },
    at: new Date().toISOString(),
  };
  k.items.push(item);
  return item;
}

export function removeItem(k, id) {
  k.items = k.items.filter((i) => i.id !== id);
}

const place = (i) => [i.where?.screen, i.where?.element].filter(Boolean).join(' · ');
const line = (i) => `- **${i.id}.** ${place(i) ? `${place(i)}: ` : ''}${i.observed}${i.rule ? ` (${i.rule})` : ''}`;

/**
 * The known items as the persona and the verifier read them. Closed issues are
 * listed apart: those are the places to look at again.
 */
export function describeKnowledge(k, { forVerifier = false } = {}) {
  const open = k.items.filter((i) => i.kind === 'issue' && i.issue?.state !== 'closed');
  const closed = k.items.filter((i) => i.kind === 'issue' && i.issue?.state === 'closed');
  const accepted = k.items.filter((i) => i.kind === 'accepted');
  const notBug = k.items.filter((i) => i.kind === 'not-bug');
  const parts = [];
  if (accepted.length) parts.push(`## Решено, что это норма\n\nНе находка. Если видишь это, запиши в "known" с этим id.\n\n${accepted.map(line).join('\n')}`);
  if (open.length) parts.push(`## Уже в задачах, ещё не исправлено\n\nНе находка, если выглядит так же. Запиши в "known" с этим id. Если стало хуже или проблема в другом месте, это новая находка.\n\n${open.map((i) => `${line(i)} — задача #${i.issue.number}`).join('\n')}`);
  if (closed.length) parts.push(`## Исправлено, проверь заново\n\nЗадача закрыта. Если по пути попадёшь в это место и проблема на месте, это находка; в начале "observed" напиши «Вернулось» и id, например «Вернулось K3:».\n\n${closed.map((i) => `${line(i)} — была задача #${i.issue.number}`).join('\n')}`);
  if (forVerifier && notBug.length) parts.push(`## Ошибки агентов в прошлом\n\nЭто агенты принимали за ошибку, а Сергей решил, что это не баг. Похожая находка — "rejected" с причиной «как» и id, например «как K5».\n\n${notBug.map(line).join('\n')}`);
  return parts.length ? `# Что уже известно\n\n${parts.join('\n\n')}` : '';
}

/** Minimal GitHub REST client; the token needs Issues read and write on one repo. */
export function github({ token = process.env.QA_AGENTS_GITHUB_TOKEN, repo = process.env.QA_AGENTS_GITHUB_REPO } = {}) {
  const call = async (method, url, body) => {
    if (!token || !repo) throw new Error('на сервере нет QA_AGENTS_GITHUB_TOKEN или QA_AGENTS_GITHUB_REPO');
    const res = await fetch(`https://api.github.com/repos/${repo}${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  return {
    configured: Boolean(token && repo),
    createIssue: (issue) => call('POST', '/issues', issue),
    getIssue: (n) => call('GET', `/issues/${n}`),
  };
}

/** Title and body of the issue filed from a finding. */
export function issueFromFinding({ finding, persona, runRel, pageUrl }) {
  const w = finding.where ?? {};
  const where = [w.screen, w.element].filter(Boolean).join(' · ');
  const title = `QA-агент: ${where ? `${where}: ` : ''}${finding.observed}`.replace(/\s+/g, ' ').slice(0, 120);
  const link = pageUrl ? `${pageUrl.replace(/\/?$/, '/')}#${runRel.split('/').slice(1).join('-')}-${finding.id}` : null;
  const body = [
    `Нашёл QA-персонаж «${persona.name}» (${persona.device}, ${persona.locale}) на тестовом стенде.`,
    '',
    `**Где:** ${where || 'не указано'}${w.url ? `, ${w.url}` : ''}`,
    finding.expected ? `**Ожидалось:** ${finding.expected}` : null,
    `**Что видно:** ${finding.observed}`,
    finding.rule ? `**Правило:** ${finding.rule} из \`translator-qa/agents/rules.md\`` : null,
    '',
    link ? `Скриншот, трейс и ход прохождения: ${link} (страница за паролем).` : null,
    '',
    'Пока задача открыта, агенты считают это известным. Когда её закроют, они проверят это место заново.',
  ]
    .filter((l) => l !== null)
    .join('\n');
  const text = `${where} ${finding.observed}`.toLowerCase();
  const labels = ['bug', /игр|game/.test(text) ? 'game' : 'UI'];
  return { title, body, labels };
}

/** Pulls the state of every filed issue from GitHub. Quiet when there is no token. */
export async function refreshIssues(dataDir, gh = github()) {
  if (!gh.configured) return 0;
  const k = loadKnowledge(dataDir);
  let changed = 0;
  for (const item of k.items.filter((i) => i.kind === 'issue' && i.issue?.number)) {
    try {
      const fresh = await gh.getIssue(item.issue.number);
      if (fresh.state !== item.issue.state) {
        item.issue.state = fresh.state;
        changed += 1;
      }
    } catch {}
  }
  if (changed) saveKnowledge(dataDir, k);
  return changed;
}

export const knowledgeExists = (dataDir) => existsSync(file(dataDir));
