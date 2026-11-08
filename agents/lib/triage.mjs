// Third pass over a batch of runs (#747). The triage agent knows the board:
// open issues, recently closed ones and their column. For every verified
// finding of the batch it decides one of three things: file a new issue, it is
// already issue #N, or it is not worth an issue. The same problem seen by
// several personas becomes one decision. The runner then acts on the answer:
// it files the issues and records every decision, so the personas treat filed
// problems as known and Sergey sees on the page why each finding went where it went.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MODELS, runClaude } from './claude.mjs';
import { addItem, decisionFor, loadKnowledge, saveKnowledge } from './knowledge.mjs';
import { anchor } from './site.mjs';
import { isShown, mergeFindings } from './verify.mjs';

export const ACTIONS = { create: 'новая задача', duplicate: 'уже есть', skip: 'не заводить' };
/** At most this many new issues per batch; the rest waits for Sergey on the page. */
export const MAX_NEW_ISSUES = 5;
const KEEP_TRIAGES = 10;
const CLOSED_DAYS = 90;

const START = '<<<TRIAGE';
const END = 'TRIAGE>>>';
const oneLine = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const place = (w) => [w?.screen, w?.element].filter(Boolean).join(' · ');

/** Board columns by issue number. Quiet when the token cannot read the project. */
export async function fetchColumns(gh, board = process.env.QA_AGENTS_BOARD ?? 'belousovsn/2') {
  const [login, number] = board.split('/');
  const columns = new Map();
  let after = null;
  for (let page = 0; page < 20; page += 1) {
    const data = await gh.graphql(
      `query($login:String!,$n:Int!,$after:String){ user(login:$login){ projectV2(number:$n){ items(first:100, after:$after){
        pageInfo{ hasNextPage endCursor }
        nodes{ isArchived status: fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } }
          content{ ... on Issue{ number repository{ nameWithOwner } } } } } } } }`,
      { login, n: Number(number), after },
    );
    const items = data.user.projectV2.items;
    for (const node of items.nodes) {
      const c = node.content;
      if (!c?.number || c.repository?.nameWithOwner?.toLowerCase() !== gh.repo.toLowerCase()) continue;
      columns.set(c.number, node.isArchived ? 'архив' : node.status?.name ?? null);
    }
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return columns;
}

/** Open issues and the ones closed lately, with their board column. */
export async function fetchBoard(gh, { now = Date.now() } = {}) {
  const since = new Date(now - CLOSED_DAYS * 86400_000).toISOString();
  const [open, closed, labels] = await Promise.all([
    gh.listIssues('state=open'),
    gh.listIssues(`state=closed&since=${since}`),
    gh.listLabels(),
  ]);
  let columns = new Map();
  let columnsError = null;
  try {
    columns = await fetchColumns(gh);
  } catch (e) {
    columnsError = e.message;
  }
  const issues = [...open, ...closed]
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      stateReason: i.state_reason ?? null,
      closedAt: i.closed_at ?? null,
      column: columns.get(i.number) ?? null,
      labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
      url: i.html_url,
      body: i.body ?? '',
    }));
  return { issues, labels: labels.map((l) => l.name), columnsError };
}

/** board.md: one block per issue, made for Grep. */
export function formatBoard(board) {
  const head = [
    '# Доска',
    '',
    `Открытые задачи и закрытые за последние ${CLOSED_DAYS} дней. У каждой: номер, состояние, колонка доски, ярлыки, заголовок, начало описания.`,
    'Колонка «On test» значит, что исправление уже на тестовом стенде и ждёт выкладки в прод.',
    board.columnsError ? `Колонки доски не прочитались (${board.columnsError}), есть только состояние.` : null,
    '',
  ].filter((l) => l !== null);
  const blocks = board.issues
    .sort((a, b) => b.number - a.number)
    .map((i) => {
      const state = i.state === 'closed' ? `закрыта${i.stateReason === 'not_planned' ? ' (не будем делать)' : ''} ${i.closedAt?.slice(0, 10) ?? ''}`.trim() : 'открыта';
      return `## #${i.number} · ${state}${i.column ? ` · ${i.column}` : ''}${i.labels.length ? ` · ${i.labels.join(', ')}` : ''}\n${i.title}\n${oneLine(i.body, 600)}\n`;
    });
  return `${head.join('\n')}\n${blocks.join('\n')}`;
}

/**
 * The findings of a batch that still need a decision: shown after the verifier,
 * not matched to something known, not decided on the page yet.
 */
export function collectFindings(runs, k) {
  const out = [];
  for (const run of runs) {
    if (!run.report || !run.rel) continue;
    for (const f of mergeFindings(run.report, run.verify)) {
      if (!isShown(f) || f.verdict === 'known' || decisionFor(k, run.rel, f.id)) continue;
      out.push({
        key: `${run.persona.id}/${f.id}`,
        run,
        finding: f,
      });
    }
  }
  return out;
}

const describeEvents = (meta) => {
  const plan = meta?.plan ?? {};
  const events = (plan.events ?? []).map((e) => e.kind).join(', ') || 'нет';
  return `события среды: ${events}; игры: ${plan.games?.mode === 'mock' ? 'мок' : 'настоящие'}`;
};

/** What has been decided before, so the agent stays consistent with it. */
export function describePastDecisions(k) {
  if (!k.items.length) return 'Решений пока нет.';
  return k.items
    .map((i) => {
      const what = i.kind === 'issue' && i.issue ? `задача #${i.issue.number}${i.issue.state === 'closed' ? ' (закрыта)' : ''}` : { accepted: 'Сергей: норма', 'not-bug': 'Сергей: не баг, ошибка агента', skipped: 'разборщик: не заводить' }[i.kind] ?? i.kind;
      return `- ${i.id} · ${what} · ${place(i.where) ? `${place(i.where)}: ` : ''}${oneLine(i.observed, 240)}${i.reason ? ` (причина: ${oneLine(i.reason, 200)})` : ''}`;
    })
    .join('\n');
}

export function buildTriagePrompt({ items, k, labels, boardFile }) {
  const findings = items.map(({ key, run, finding: f }) => ({
    key,
    persona: `${run.persona.name}, ${run.persona.device}, ${run.persona.locale}`,
    run: describeEvents(run.meta),
    severity: f.severity,
    rule: f.rule ?? null,
    where: f.where ?? null,
    observed: f.observed,
    expected: f.expected ?? null,
    verifier: f.verdict === 'missed' ? 'заметил проверяющий' : f.reason ?? null,
    screenshot: f.screenshot ? `${run.rel}/${f.screenshot}` : null,
  }));
  return `Ты разбираешь находки QA-агентов. Агенты ходят по тестовому стенду приложения MemDecks как пользователи, второй агент уже проверил их находки по снимкам. Ты решаешь, что из этого станет задачей на доске разработки. Доску ведёт один человек, Сергей. Лишняя задача отнимает его время, а пропущенная ошибка дойдёт до пользователей. Поэтому заводи задачу только на ту проблему, которую можно понять и исправить, и никогда не заводи вторую задачу на то, что уже есть.

# Что у тебя есть

- ${boardFile}: доска, все открытые задачи и закрытые за ${CLOSED_DAYS} дней. Ищи по ней инструментом Grep: по названию экрана, элементу, тексту ошибки, адресу запроса, названию игры. Описания в доске обрезаны; если нужно больше, смотри заголовок и ярлыки.
- Снимки находок: пути в поле screenshot, открывай инструментом Read, если текста не хватает.
- Решения, принятые раньше:

${describePastDecisions(k)}

# Как решать

Для каждой находки (или группы находок про одну проблему) выбери действие:

- "duplicate" — на доске уже есть задача про эту же проблему, открытая или в колонке «On test». Совпадение по сути, а не по словам: одна и та же ошибка на одном экране, даже если описана иначе. Если проблема входит в более широкую открытую задачу, которая её явно покрывает, это тоже "duplicate". Укажи её номер в "issue". Если задача в «On test», а проблема на стенде всё ещё видна, поставь "stillVisible": true.
- "create" — проблема настоящая и её нет на доске. Закрытая задача про то же самое, а проблема снова видна: это "create", и в "problem" напиши «Вернулось после #N».
- "skip" — задача не нужна. Причины: так задумано (см. решения «норма» и описания задач на доске); проблему вызвало само тестирование, а не приложение (подменённые часы, мок игр, общий IP стенда, тестовые аккаунты); находка слишком расплывчатая, чтобы её исправить; совпадает с прошлой ошибкой агентов.

Находки разных персонажей про одну проблему объедини в одно решение: перечисли все их ключи в "findings".

Новых задач за один разбор не больше ${MAX_NEW_ISSUES}; если настоящих проблем больше, заведи самые серьёзные, остальным поставь "skip" с причиной «оставлено Сергею».

Для "create":
- "title" — по-русски, суть проблемы словами пользователя, до 90 знаков, без слов «баг» и «QA».
- "problem" — что не так, одним-тремя предложениями. "expected" — что должно быть. Без вводных слов.
- "labels" — тип и область, только из этого списка: ${labels.join(', ')}. Обычно "bug" и одна область.

"reason" — одно предложение: почему такое действие. Для "duplicate" — чем совпадает, для "skip" — почему не нужна задача.

# Ответ

Обычными предложениями, по-русски. В конце выведи ровно один JSON между строками ${START} и ${END}:

${START}
{
  "decisions": [
    { "findings": ["guest-ru-phone/F2", "hy-veteran/F3"], "action": "create", "title": "Подвал на английском при русском интерфейсе", "problem": "…", "expected": "…", "labels": ["bug", "UI"], "reason": "…" },
    { "findings": ["shared-laptop/F1"], "action": "duplicate", "issue": 812, "stillVisible": false, "reason": "…" },
    { "findings": ["hy-veteran/F1"], "action": "skip", "reason": "…" }
  ]
}
${END}

Каждый ключ из списка ниже должен попасть ровно в одно решение.

# Находки

${JSON.stringify(findings, null, 2)}`;
}

export function extractTriage(text) {
  const start = text.lastIndexOf(START);
  const end = text.lastIndexOf(END);
  if (start < 0 || end < start) return null;
  const raw = text.slice(start + START.length, end).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const out = JSON.parse(raw);
    return Array.isArray(out?.decisions) ? out : null;
  } catch {
    return null;
  }
}

/** Removes secret values and anything that looks like a token before text leaves the box. */
export function scrub(text, secrets = []) {
  let t = String(text ?? '');
  for (const s of secrets) if (s && s.length >= 6) t = t.split(s).join('«скрыто»');
  return t.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '«токен скрыт»');
}

export function readSecretValues(file) {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => l.slice(l.indexOf('=') + 1).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const findingLink = (pageUrl, run, id) => (pageUrl ? `${pageUrl.replace(/\/?$/, '/')}#${anchor(run, id)}` : null);

/** Issue body: what is wrong, what should be, where, and every sighting. */
export function issueBody({ decision, items, pageUrl }) {
  const first = items[0].finding;
  const w = first.where ?? {};
  const sightings = items.map(({ run, finding: f }) => {
    const link = findingLink(pageUrl, run, f.id);
    const when = (run.meta?.startedAt ?? '').slice(0, 10);
    return `- «${run.persona.name}» (${run.persona.device}, ${run.persona.locale})${when ? `, ${when}` : ''}: ${oneLine(f.observed, 300)}${link ? ` [скриншот и трейс](${link})` : ''}`;
  });
  return [
    `**Что не так:** ${decision.problem ?? first.observed}`,
    decision.expected || first.expected ? `**Что должно быть:** ${decision.expected ?? first.expected}` : null,
    `**Где:** ${place(w) || 'не указано'}${w.url ? `, ${w.url}` : ''}`,
    '',
    'Видели QA-персонажи на тестовом стенде:',
    ...sightings,
    '',
    `Завёл разборщик QA-агентов: ${decision.reason ?? ''}`.trim(),
    pageUrl ? 'Страница с прогонами закрыта паролем.' : null,
    '',
    'Пока задача открыта, агенты считают это известным. Когда её закроют, они проверят это место заново.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Acts on the agent's answer: files issues, records every decision. Returns
 * what happened, one entry per decision, for the page and Telegram.
 */
export async function applyTriage({ answer, items, board, gh, dataDir, pageUrl, secrets = [] }) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const known = new Map(board.issues.map((i) => [i.number, i]));
  const labels = new Set(board.labels);
  const k = loadKnowledge(dataDir);
  const applied = [];
  const used = new Set();
  let created = 0;
  for (const d of answer.decisions) {
    const group = (d.findings ?? []).map((key) => byKey.get(key)).filter((i) => i && !used.has(i.key));
    if (!group.length) continue;
    group.forEach((i) => used.add(i.key));
    let action = d.action;
    let reason = oneLine(d.reason, 400);
    let issue = null;
    if (action === 'duplicate') {
      const target = known.get(Number(d.issue));
      if (target) issue = { number: target.number, url: target.url, state: target.state };
      else {
        action = 'skip';
        reason = `разборщик назвал задачу #${d.issue}, которой нет на доске; оставлено Сергею`;
      }
    }
    if (action === 'create') {
      if (created >= MAX_NEW_ISSUES) {
        action = 'skip';
        reason = `больше ${MAX_NEW_ISSUES} новых задач за разбор; оставлено Сергею`;
      } else {
        try {
          const chosen = (d.labels ?? []).filter((l) => labels.has(l));
          const out = await gh.createIssue({
            title: scrub(`QA-агент: ${oneLine(d.title ?? group[0].finding.observed, 100)}`, secrets),
            body: scrub(issueBody({ decision: d, items: group, pageUrl }), secrets),
            labels: chosen.length ? chosen : labels.has('bug') ? ['bug'] : [],
          });
          issue = { number: out.number, url: out.html_url, state: out.state };
          created += 1;
        } catch (e) {
          applied.push({ action: 'error', findings: group.map((i) => i.key), reason: `задача не завелась: ${e.message}` });
          continue;
        }
      }
    }
    if (!['create', 'duplicate', 'skip'].includes(action)) continue;
    for (const i of group) {
      addItem(k, {
        kind: action === 'skip' ? 'skipped' : 'issue',
        finding: i.finding,
        runRel: i.run.rel,
        persona: i.run.persona.id,
        issue,
        by: 'triage',
        reason,
      });
    }
    applied.push({
      action,
      findings: group.map((i) => i.key),
      title: action === 'create' ? oneLine(d.title, 100) : issue ? known.get(issue.number)?.title ?? null : null,
      issue,
      stillVisible: action === 'duplicate' && Boolean(d.stillVisible),
      reason,
      severity: group.map((i) => i.finding.severity).sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b))[0],
    });
  }
  saveKnowledge(dataDir, k);
  const left = items.filter((i) => !used.has(i.key)).map((i) => i.key);
  return { applied, left };
}

function prune(dir) {
  if (!existsSync(dir)) return;
  for (const old of readdirSync(dir).sort().reverse().slice(KEEP_TRIAGES)) rmSync(path.join(dir, old), { recursive: true, force: true });
}

/** The whole pass for one batch of runs. Quiet when nothing needs a decision. */
export async function triageBatch({ runs, gh, dataDir, pageUrl, secrets = [], log = () => {}, timeoutMs = 20 * 60 * 1000 }) {
  if (!gh.configured) return { skipped: 'нет GitHub-токена' };
  const k = loadKnowledge(dataDir);
  const items = collectFindings(runs, k);
  if (!items.length) return { applied: [], left: [] };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(dataDir, 'triage');
  const dir = path.join(root, stamp);
  mkdirSync(dir, { recursive: true });
  const board = await fetchBoard(gh);
  if (board.columnsError) log(`triage: board columns unavailable: ${board.columnsError}`);
  const boardRel = `triage/${stamp}/board.md`;
  writeFileSync(path.join(dir, 'board.md'), formatBoard(board));
  const prompt = buildTriagePrompt({ items, k, labels: board.labels, boardFile: boardRel });
  writeFileSync(path.join(dir, 'prompt.md'), prompt);
  const r = await runClaude({
    prompt,
    model: MODELS.triage,
    cwd: dataDir,
    logFile: path.join(dir, 'stream.jsonl'),
    timeoutMs,
    args: ['--strict-mcp-config', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--max-turns', '80'],
  });
  const answer = extractTriage(r.text);
  if (!answer) {
    const out = { error: oneLine(r.text || r.stderr, 400), applied: [], left: items.map((i) => i.key) };
    writeFileSync(path.join(dir, 'triage.json'), JSON.stringify(out, null, 2));
    prune(root);
    return out;
  }
  const out = { ...(await applyTriage({ answer, items, board, gh, dataDir, pageUrl, secrets })), model: MODELS.triage, numTurns: r.numTurns };
  writeFileSync(path.join(dir, 'triage.json'), JSON.stringify({ answer, ...out }, null, 2));
  prune(root);
  return out;
}

/** Telegram lines for the triage result. */
export function describeTriage(t) {
  if (!t) return [];
  if (t.skipped) return [];
  if (t.error) return ['', `Разбор по доске не прошёл: ${oneLine(t.error, 200)}`];
  if (!t.applied?.length && !t.left?.length) return [];
  const lines = ['', 'Разбор по доске:'];
  for (const a of t.applied.filter((x) => x.action === 'create')) lines.push(`• новая #${a.issue.number}: ${a.title}\n  ${a.issue.url}`);
  for (const a of t.applied.filter((x) => x.action === 'duplicate')) lines.push(`• уже есть #${a.issue.number}${a.stillVisible ? ', в On test, но на стенде всё ещё видно' : ''}: ${a.title ?? ''}`.trimEnd());
  const skipped = t.applied.filter((x) => x.action === 'skip');
  if (skipped.length) lines.push(`• не заводить: ${skipped.length} (причины на странице)`);
  const errors = t.applied.filter((x) => x.action === 'error');
  for (const e of errors) lines.push(`• ${e.reason}`);
  if (t.left?.length) lines.push(`• без решения: ${t.left.length}`);
  return lines;
}
