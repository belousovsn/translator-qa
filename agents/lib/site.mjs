import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isRunnable } from './personas.mjs';
import { isShown, mergeFindings, VERDICTS } from './verify.mjs';
import { decisionFor, DECISIONS, loadKnowledge } from './knowledge.mjs';

export const KEEP_RUNS = 2;

/** Stable id of a finding on the page, used by links from Telegram. */
export const anchor = (run, id) => `${run.rel.split('/').slice(1).join('-')}-${id}`;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** Newest first: run folders are named by UTC timestamp. */
export function listRuns(dataDir, personaId) {
  const dir = path.join(dataDir, 'runs', personaId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(path.join(dir, d, 'meta.json')))
    .sort()
    .reverse()
    .map((d) => ({
      rel: `runs/${personaId}/${d}`,
      dir: path.join(dir, d),
      meta: readJson(path.join(dir, d, 'meta.json')),
      report: readJson(path.join(dir, d, 'report.json')),
      verify: readJson(path.join(dir, d, 'verify.json')),
    }));
}

const SEVERITY = { high: 'серьёзно', medium: 'средне', low: 'мелочь' };
const ORDER = { high: 0, medium: 1, low: 2 };

/**
 * A finding still waits for Sergey: nobody decided it, or only the triage
 * agent said "not worth an issue". Issues and duplicates the triage agent
 * filed are on the board and do not wait.
 */
export function isPending(k, run, f) {
  if (!isShown(f) || f.verdict === 'known') return false;
  const d = decisionFor(k, run.rel, f.id);
  return !d || (d.kind === 'skipped' && d.by === 'triage');
}

/** Every finding that waits for Sergey, in every kept run, worst and newest first. */
export function pendingFindings(dataDir, personas, k = loadKnowledge(dataDir)) {
  const out = [];
  for (const p of personas) {
    for (const run of listRuns(dataDir, p.id)) {
      if (!run.report) continue;
      for (const f of mergeFindings(run.report, run.verify)) {
        if (isPending(k, run, f)) out.push({ persona: p, run, finding: f, decision: decisionFor(k, run.rel, f.id) });
      }
    }
  }
  return out.sort((a, b) => (ORDER[a.finding.severity] ?? 3) - (ORDER[b.finding.severity] ?? 3) || b.run.meta.startedAt.localeCompare(a.run.meta.startedAt));
}

/** Runs older than the last KEEP_RUNS that may go: none of their findings waits for Sergey. */
export function prunableRuns(dataDir, personaId, k = loadKnowledge(dataDir)) {
  return listRuns(dataDir, personaId)
    .slice(KEEP_RUNS)
    .filter((run) => !run.report || !mergeFindings(run.report, run.verify).some((f) => isPending(k, run, f)));
}

const decideButtons = (run, f) => {
  const btn = (kind, label) => `<button type="button" data-decide="${kind}" data-run-rel="${esc(run.rel)}" data-finding="${esc(f.id)}">${label}</button>`;
  return `<div class="decide">${btn('issue', 'В задачу')}${btn('skipped', 'Пропустить')}${btn('accepted', 'Норма')}${btn('not-bug', 'Не баг')}</div>`;
};
const STATUS = { ok: 'готово', 'no-report': 'нет отчёта', error: 'ошибка', limit: 'лимит' };

const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { timeZone: 'Asia/Yerevan', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function renderRun(run, i, k = { items: [] }) {
  const open = i === 0 ? ' open' : '';
  const { meta, report: r } = run;
  const minutes = meta.durationMs ? Math.round(meta.durationMs / 60000) : null;
  const events = meta.plan?.events?.length
    ? meta.plan.events.map((e) => `${esc(e.kind)} после ${e.afterStep}`).join(', ')
    : 'нет';
  const head = `<div class="run-head">
    <strong>${esc(fmtDate(meta.startedAt))}</strong>
    <span class="badge s-${esc(meta.status)}">${esc(STATUS[meta.status] ?? meta.status)}</span>
    ${meta.deploy ? `<span class="badge">после деплоя ${esc(meta.deploy.shas.map((x) => x.slice(0, 7)).join(', '))}</span>` : ''}
    <span class="muted">${minutes != null ? `${minutes} мин · ` : ''}${meta.numTurns ?? '?'} ходов · ${esc(meta.model)} · зерно ${meta.plan?.seed ?? '?'} · события: ${events}${meta.plan?.games ? ` · игры: ${meta.plan.games.mode === 'mock' ? 'мок' : 'настоящие'}, выходы ${esc(meta.plan.games.exits.join(', '))}` : ''}</span>
  </div>`;
  const links = `<div class="links">
    ${existsSync(path.join(run.dir, 'trace.zip')) ? `<a class="trace" data-trace="${esc(run.rel)}/trace.zip" href="#">Трейс</a>` : ''}
    ${meta.sessionLog ? `<a href="${esc(run.rel)}/${esc(meta.sessionLog)}">Журнал вызовов</a>` : ''}
    <a href="${esc(run.rel)}/stream.jsonl">Поток Claude</a>
  </div>`;
  if (!r) {
    return `<details class="run"${open}><summary>${head}</summary><p class="muted">${esc(meta.error ?? 'Агент не выдал отчёт.')}</p>${links}</details>`;
  }
  const goals = (r.goals ?? [])
    .map((g) => `<li class="${g.reached ? 'ok' : 'bad'}">${g.reached ? '✓' : '✗'} ${esc(g.goal)}${g.note ? ` <span class="muted">${esc(g.note)}</span>` : ''}</li>`)
    .join('');
  const steps = (r.steps ?? [])
    .map(
      (s) =>
        `<li class="${s.event ? 'event' : ''} ${s.ok === false ? 'bad' : ''}"><span class="n">${esc(s.n)}</span> ${s.event ? `<span class="tag">${esc(s.event)}</span> ` : ''}${esc(s.action)} <span class="arrow">→</span> ${esc(s.result)}</li>`,
    )
    .join('');
  const all = mergeFindings(r, run.verify);
  const renderDecision = (f) => {
    if (f.verdict === 'known') {
      const item = k.items.find((x) => x.id === f.known);
      return `<div class="decision">Известно: ${esc(f.known ?? '')}${item?.issue ? ` · <a href="${esc(item.issue.url)}">#${item.issue.number}</a>` : ''}</div>`;
    }
    const d = decisionFor(k, run.rel, f.id);
    const buttons = decideButtons(run, f);
    if (d) {
      const who = d.by === 'triage' ? 'Разборщик' : 'Решение';
      const what = d.kind === 'issue' && d.issue ? `в задаче <a href="${esc(d.issue.url)}">#${d.issue.number}</a>${d.issue.state === 'closed' ? ' (закрыта)' : ''}` : esc(DECISIONS[d.kind]);
      const why = d.reason ? `<div class="muted">${esc(d.reason)}</div>` : '';
      // A triage "not worth an issue" stays open to Sergey's own decision.
      return `<div class="decision">${who}: ${what} · ${esc(d.id)} <button type="button" class="link" data-undo="${esc(d.id)}">отменить</button>${why}</div>${d.kind === 'skipped' && d.by === 'triage' ? buttons : ''}`;
    }
    if (!isShown(f)) return '';
    return buttons;
  };
  const renderFinding = (f) => {
    // Agents name some shots finding-Fn.png; others keep the MCP's own name in out/.
    const dir = f.screenshot && ['', 'out'].find((sub) => existsSync(path.join(run.dir, sub, path.basename(f.screenshot))));
    const shot = dir != null ? `${run.rel}/${dir ? `${dir}/` : ''}${path.basename(f.screenshot)}` : null;
    const w = f.where ?? {};
    const place = [w.screen, w.element].filter(Boolean).join(' · ');
    return `<li class="finding sev-${esc(f.severity)}" id="${esc(anchor(run, f.id))}">
      <div><strong>${esc(f.id)}</strong> <span class="badge">${esc(SEVERITY[f.severity] ?? f.severity)}</span>${f.verdict ? ` <span class="badge v-${esc(f.verdict)}">${esc(f.verdict === 'missed' ? 'заметил проверяющий' : VERDICTS[f.verdict] ?? f.verdict)}</span>` : ''} ${esc(f.rule ?? '')}${f.step != null ? ` · шаг ${esc(f.step)}` : ''}</div>
      ${place || w.url ? `<div class="where">Где: ${esc(place)}${w.url ? ` <a href="${esc(w.url)}" class="muted">${esc(w.url.replace(/^https?:\/\//, ''))}</a>` : ''}</div>` : ''}
      ${f.expected ? `<div>Ожидал: ${esc(f.expected)}</div>` : ''}
      <div>${f.verdict === 'missed' ? '' : 'Увидел: '}${esc(f.observed)}</div>
      ${f.originalObserved ? `<div class="muted">Агент писал: ${esc(f.originalObserved)}</div>` : ''}
      ${f.reason ? `<div class="muted">Проверка: ${esc(f.reason)}</div>` : ''}
      ${shot ? `<a href="${esc(shot)}"><img src="${esc(shot)}" alt="${esc(f.id)}" loading="lazy"></a>` : ''}
      ${renderDecision(f)}
    </li>`;
  };
  const findings = all.filter(isShown).map(renderFinding).join('');
  const dropped = all.filter((f) => !isShown(f));
  const droppedHtml = dropped.length
    ? `<details><summary>Отклонено и не проверить (${dropped.length})</summary><ul class="findings">${dropped.map(renderFinding).join('')}</ul></details>`
    : '';
  const verifyNote = run.verify?.error ? `<p class="bad">Проверка не прошла: ${esc(run.verify.error)}</p>` : !run.verify ? '<p class="muted">Находки не проверены.</p>' : '';
  const known = (r.known ?? []).map((k) => `<li>${esc(k.accepted)} · шаг ${esc(k.step)}${k.note ? ` · ${esc(k.note)}` : ''}</li>`).join('');
  return `<details class="run"${open}>
    <summary>${head}</summary>
    ${meta.deploy ? `<div class="deploy"><strong>Что поменялось:</strong> ${esc(meta.deploy.summary)}<ul>${(meta.deploy.focus ?? []).map((f) => `<li>${esc(f.area)}: ${esc(f.how)}</li>`).join('')}</ul></div>` : ''}
    <p>${esc(r.summary)}</p>
    ${goals ? `<h4>Цели</h4><ul class="goals">${goals}</ul>` : ''}
    ${verifyNote}
    ${findings ? `<h4>Находки</h4><ul class="findings">${findings}</ul>` : '<p class="ok">Находок нет.</p>'}
    ${droppedHtml}
    ${known ? `<details><summary>Известное (${r.known.length})</summary><ul>${known}</ul></details>` : ''}
    <details><summary>Ход прохождения (${r.steps?.length ?? 0})</summary><ol class="steps">${steps}</ol></details>
    ${links}
  </details>`;
}

function renderPending(items) {
  if (!items.length) return '<section class="pending" id="pending"><h2>Ждут решения</h2><p class="muted">Ничего не ждёт.</p></section>';
  const rows = items
    .map(({ persona, run, finding: f, decision: d }) => {
      const w = f.where ?? {};
      const place = [w.screen, w.element].filter(Boolean).join(' · ');
      const triage = d ? `<div class="muted">Разборщик предлагает не заводить: ${esc(d.reason ?? '')}</div>` : '';
      return `<li class="finding sev-${esc(f.severity)}">
        <div><span class="badge">${esc(SEVERITY[f.severity] ?? f.severity)}</span> <strong>${esc(persona.name.split(',')[0])}</strong> <span class="muted">${esc(fmtDate(run.meta.startedAt))}</span> <a href="#${esc(anchor(run, f.id))}" class="muted">подробнее</a></div>
        <div>${place ? `${esc(place)}: ` : ''}${esc(f.observed)}</div>
        ${triage}
        ${decideButtons(run, f)}
      </li>`;
    })
    .join('');
  return `<section class="pending" id="pending"><h2>Ждут решения (${items.length})</h2><div class="muted">Находки всех прогонов, по которым ты ещё не решил. Прогон с такой находкой не удаляется.</div><ul class="findings">${rows}</ul></section>`;
}

function renderKnowledge(k) {
  if (!k.items.length) return '';
  const rows = k.items
    .map((i) => {
      const where = [i.where?.screen, i.where?.element].filter(Boolean).join(' · ');
      const what = i.kind === 'issue' && i.issue ? `<a href="${esc(i.issue.url)}">#${i.issue.number}</a>${i.issue.state === 'closed' ? ' закрыта' : ''}` : esc(DECISIONS[i.kind]);
      return `<li><strong>${esc(i.id)}</strong> ${what}${i.by === 'triage' ? ' <span class="muted">(разборщик)</span>' : ''} · ${where ? `${esc(where)}: ` : ''}${esc(i.observed)} <button type="button" class="link" data-undo="${esc(i.id)}">отменить</button></li>`;
    })
    .join('');
  return `<details class="knowledge"><summary>Решения по находкам (${k.items.length})</summary><ul>${rows}</ul></details>`;
}

export function renderSite(dataDir, personas) {
  const k = loadKnowledge(dataDir);
  // Personas that can run come first; the ones waiting for accounts sink.
  const sections = [...personas.filter(isRunnable), ...personas.filter((p) => !isRunnable(p))]
    .map((p) => {
      // Older runs are only still here when a finding in them waits for a decision.
      const runs = listRuns(dataDir, p.id);
      const sub = `${esc(p.device)} · ${esc(p.locale)} · ${esc(p.colorScheme ?? 'light')}`;
      const body = !isRunnable(p)
        ? '<p class="muted">Ждёт тестовых аккаунтов.</p>'
        : runs.length
          ? runs.map((run, i) => renderRun(run, i, k)).join('')
          : '<p class="muted">Ещё не запускался.</p>';
      const last = runs[0];
      const shown = last?.report ? mergeFindings(last.report, last.verify).filter(isShown).length : null;
      const stat = !isRunnable(p) || !last
        ? ''
        : `<span class="badge s-${esc(last.meta.status)}">${esc(STATUS[last.meta.status] ?? last.meta.status)}</span><span class="muted">${esc(fmtDate(last.meta.startedAt))}${shown != null ? ` · находок ${shown}` : ''}</span>`;
      return `<details class="persona" data-id="${esc(p.id)}"><summary><span class="p-body"><span class="p-head"><h2>${esc(p.name)}</h2>${stat}</span><span class="muted">${sub}</span></span>${isRunnable(p) ? `<button type="button" class="run-btn" data-run="${esc(p.id)}">Запустить</button>` : ''}</summary>${body}</details>`;
    })
    .join('');
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA-агенты</title>
<style>
:root { --bg:#f7f7f5; --card:#fff; --text:#1d1d1b; --muted:#6b6b66; --line:#e3e2dc; --ok:#2f7d4f; --bad:#b3372f; --mid:#a86a12; --accent:#2c5fa8; --tag:#ece9ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --card:#1f1f1d; --text:#ecebe6; --muted:#9a9993; --line:#33332f; --ok:#6cc08b; --bad:#ef7d74; --mid:#e0a24a; --accent:#8db3f0; --tag:#34305a; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:960px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:18px; margin:0; } h4 { margin:14px 0 6px; font-size:14px; }
.muted { color:var(--muted); font-size:13px; }
.persona { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-top:12px; }
.persona > summary { margin:0; display:flex; gap:6px; align-items:baseline; }
.p-body { display:flex; flex-direction:column; gap:2px; min-width:0; }
.p-head { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; }
summary { list-style:none; } summary::-webkit-details-marker { display:none; }
.persona > summary::before, .run > summary .run-head::before { content:'▸'; color:var(--muted); display:inline-block; flex:none; width:1em; transition:transform .15s; }
.persona[open] > summary::before, .run[open] > summary .run-head::before { transform:rotate(90deg); }
.toolbar { display:flex; gap:8px; margin-top:12px; }
.toolbar button { font:inherit; font-size:13px; color:var(--text); background:var(--card); border:1px solid var(--line); border-radius:6px; padding:4px 10px; cursor:pointer; }
.toolbar button:hover, .run-btn:hover { border-color:var(--muted); }
.toolbar .primary { background:var(--text); color:var(--bg); border-color:var(--text); }
.run-btn { margin-left:auto; flex:none; align-self:center; font:inherit; font-size:13px; color:var(--text); background:var(--card); border:1px solid var(--line); border-radius:6px; padding:4px 10px; cursor:pointer; }
button:disabled { opacity:.5; cursor:default; }
.status { margin-top:12px; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--card); font-size:14px; }
.status.busy { border-color:var(--accent); }
.run { border-top:1px solid var(--line); margin-top:12px; padding-top:10px; }
.run > summary { margin:0; }
.run-head { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; }
.badge { font-size:12px; padding:1px 8px; border-radius:999px; border:1px solid var(--line); }
.s-ok { color:var(--ok); } .s-error,.s-no-report,.s-limit { color:var(--bad); }
ul,ol { padding-left:20px; margin:4px 0; }
.goals { list-style:none; padding-left:0; } .ok { color:var(--ok); } .bad { color:var(--bad); }
.steps { list-style:none; padding-left:0; } .steps li { margin:2px 0; padding:0 4px; } .steps .n { color:var(--muted); font-variant-numeric:tabular-nums; } .arrow { color:var(--muted); }
.steps .event { background:var(--tag); border-radius:4px; } .steps .bad { color:inherit; text-decoration:underline wavy var(--bad); }
.tag { font-size:12px; color:var(--accent); }
.findings { list-style:none; padding-left:0; } .finding { border-left:3px solid var(--line); padding:6px 10px; margin:8px 0; }
.sev-high { border-color:var(--bad); } .sev-medium { border-color:var(--mid); }
.v-confirmed { color:var(--ok); } .v-reworded { color:var(--mid); } .v-rejected,.v-unverifiable { color:var(--muted); } .v-missed { color:var(--accent); }
.deploy { font-size:14px; background:var(--tag); border-radius:6px; padding:6px 10px; margin-top:8px; } .where { font-size:14px; }
.decide { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; } .decide button, .knowledge button { font:inherit; font-size:13px; color:var(--text); background:var(--card); border:1px solid var(--line); border-radius:6px; padding:3px 10px; cursor:pointer; } .decide button:hover { border-color:var(--muted); }
.decision { margin-top:8px; font-size:14px; color:var(--muted); } button.link { font:inherit; font-size:13px; background:none; border:none; padding:0; color:var(--accent); text-decoration:underline; cursor:pointer; }
.pending { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-top:12px; } .pending .finding { margin:10px 0; }
.knowledge { margin-top:12px; } .knowledge li { margin:4px 0; } .finding:target { background:var(--tag); }
.finding img { display:block; max-width:100%; max-height:320px; margin-top:6px; border:1px solid var(--line); border-radius:6px; }
.links { display:flex; gap:14px; margin-top:10px; flex-wrap:wrap; } a { color:var(--accent); }
details summary { cursor:pointer; margin-top:10px; }
details:not(.persona):not(.run) > summary::before { content:'▸ '; color:var(--muted); } details:not(.persona):not(.run)[open] > summary::before { content:'▾ '; }
</style></head>
<body><main>
<h1>QA-агенты</h1>
<div class="muted">Последние ${KEEP_RUNS} прогона каждого персонажа и старые, где что-то ждёт решения. Обновлено ${esc(fmtDate(new Date().toISOString()))}.</div>
<div class="status" id="status" hidden></div>
${renderPending(pendingFindings(dataDir, personas.filter(isRunnable), k))}
${renderKnowledge(k)}
<div class="toolbar"><button type="button" class="primary" data-run="all">Запустить всех гостей</button><button type="button" data-all="open">Развернуть всех</button><button type="button" data-all="close">Свернуть всех</button></div>
${sections}
</main>
<script>
for (const a of document.querySelectorAll('a.trace')) {
  a.href = 'trace-viewer/index.html?trace=' + encodeURIComponent(new URL(a.dataset.trace, location.href).href);
}
// Which personas are open is remembered per browser; the page works without it.
const KEY = 'qa-agents-open';
const personas = [...document.querySelectorAll('details.persona')];
let saved = [];
try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
for (const d of personas) if (saved.includes(d.dataset.id)) d.open = true;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(personas.filter((d) => d.open).map((d) => d.dataset.id))); } catch {} };
for (const d of personas) d.addEventListener('toggle', save);
for (const b of document.querySelectorAll('[data-all]')) {
  b.addEventListener('click', () => { for (const d of personas) d.open = b.dataset.all === 'open'; save(); });
}
// A link to a finding (from Telegram) opens everything around it.
function reveal() {
  const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!el) return;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  el.scrollIntoView({ block: 'center' });
}
reveal();
addEventListener('hashchange', reveal);

// Decisions on findings: file an issue, accept as normal, mark as not a bug, undo.
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qa-agents': '1' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || r.status);
  return out;
}
for (const b of document.querySelectorAll('[data-decide]')) {
  b.addEventListener('click', async () => {
    if (b.dataset.decide === 'issue' && !confirm('Завести задачу на GitHub по этой находке?')) return;
    for (const x of b.parentElement.querySelectorAll('button')) x.disabled = true;
    try {
      await post('api/decide', { run: b.dataset.runRel, finding: b.dataset.finding, decision: b.dataset.decide });
      location.reload();
    } catch (err) {
      alert('Не получилось: ' + err.message);
      for (const x of b.parentElement.querySelectorAll('button')) x.disabled = false;
    }
  });
}
for (const b of document.querySelectorAll('[data-undo]')) {
  b.addEventListener('click', async () => {
    if (!confirm('Отменить решение ' + b.dataset.undo + '? Заведённая задача на GitHub останется.')) return;
    try { await post('api/undo', { id: b.dataset.undo }); location.reload(); } catch (err) { alert('Не получилось: ' + err.message); }
  });
}

// Manual runs and the runner's state, through the small API next to the page.
const names = Object.fromEntries(personas.map((d) => [d.dataset.id, d.querySelector('h2').textContent.split(',')[0]]));
const runnableIds = [...document.querySelectorAll('.run-btn')].map((b) => b.dataset.run);
const STATE = { running: 'идёт по сайту', verifying: 'проверяющий смотрит отчёт', planning: 'планировщик читает дифф', probing: 'проверяем лимит подписки', waiting: 'ждём сброса лимита' };
const time = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const box = document.getElementById('status');
let wasBusy = false;
async function refresh() {
  let s;
  try { s = await (await fetch('api/status', { cache: 'no-store' })).json(); } catch { box.hidden = true; return; }
  const busy = s.state !== 'idle';
  const parts = [];
  if (busy) {
    const who = s.persona ? (names[s.persona] || s.persona) + ': ' : '';
    parts.push('Сейчас ' + who + (STATE[s.state] || s.state) + (s.since ? ' с ' + time(s.since) : '') + (s.until ? ', до ' + time(s.until) : ''));
  }
  const q = (s.queue || []).map((j) => j.kind === 'manual' ? 'ручной: ' + j.personas.map((id) => names[id] || id).join(', ') : 'деплой ' + j.sha.slice(0, 7));
  if (q.length) parts.push('В очереди: ' + q.join('; '));
  box.textContent = parts.join('. ') || 'Сейчас ничего не идёт.';
  box.className = 'status' + (busy ? ' busy' : '');
  box.hidden = false;
  // A run that just finished has rewritten this page.
  if (wasBusy && !busy && !q.length) location.reload();
  wasBusy = busy || q.length > 0;
}
for (const b of document.querySelectorAll('[data-run]')) {
  b.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = b.dataset.run === 'all' ? runnableIds : [b.dataset.run];
    b.disabled = true;
    try {
      const r = await fetch('api/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-qa-agents': '1' }, body: JSON.stringify({ personas: ids }) });
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      await refresh();
    } catch (err) {
      alert('Не получилось поставить запуск: ' + err.message);
    } finally {
      setTimeout(() => { b.disabled = false; }, 3000);
    }
  });
}
refresh();
setInterval(refresh, 10000);
</script>
</body></html>`;
  writeFileSync(path.join(dataDir, 'index.html'), html);
}
