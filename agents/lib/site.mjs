import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isRunnable } from './personas.mjs';

export const KEEP_RUNS = 2;

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
    }));
}

const SEVERITY = { high: 'серьёзно', medium: 'средне', low: 'мелочь' };
const STATUS = { ok: 'готово', 'no-report': 'нет отчёта', error: 'ошибка', limit: 'лимит' };

const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { timeZone: 'Asia/Yerevan', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function renderRun(run) {
  const { meta, report: r } = run;
  const minutes = meta.durationMs ? Math.round(meta.durationMs / 60000) : null;
  const events = meta.plan?.events?.length
    ? meta.plan.events.map((e) => `${esc(e.kind)} после ${e.afterStep}`).join(', ')
    : 'нет';
  const head = `<div class="run-head">
    <strong>${esc(fmtDate(meta.startedAt))}</strong>
    <span class="badge s-${esc(meta.status)}">${esc(STATUS[meta.status] ?? meta.status)}</span>
    <span class="muted">${minutes != null ? `${minutes} мин · ` : ''}${meta.numTurns ?? '?'} ходов · ${esc(meta.model)} · зерно ${meta.plan?.seed ?? '?'} · события: ${events}</span>
  </div>`;
  const links = `<div class="links">
    ${existsSync(path.join(run.dir, 'trace.zip')) ? `<a class="trace" data-trace="${esc(run.rel)}/trace.zip" href="#">Трейс</a>` : ''}
    ${meta.sessionLog ? `<a href="${esc(run.rel)}/${esc(meta.sessionLog)}">Журнал вызовов</a>` : ''}
    <a href="${esc(run.rel)}/stream.jsonl">Поток Claude</a>
  </div>`;
  if (!r) {
    return `<article class="run">${head}<p class="muted">${esc(meta.error ?? 'Агент не выдал отчёт.')}</p>${links}</article>`;
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
  const findings = (r.findings ?? [])
    .map((f) => {
      const shot = f.screenshot && existsSync(path.join(run.dir, f.screenshot)) ? `${run.rel}/${f.screenshot}` : null;
      return `<li class="finding sev-${esc(f.severity)}">
        <div><strong>${esc(f.id)}</strong> <span class="badge">${esc(SEVERITY[f.severity] ?? f.severity)}</span> ${esc(f.rule ?? '')} · шаг ${esc(f.step)}</div>
        <div>Ожидал: ${esc(f.expected)}</div>
        <div>Увидел: ${esc(f.observed)}</div>
        ${shot ? `<a href="${esc(shot)}"><img src="${esc(shot)}" alt="${esc(f.id)}" loading="lazy"></a>` : ''}
      </li>`;
    })
    .join('');
  const known = (r.known ?? []).map((k) => `<li>${esc(k.accepted)} · шаг ${esc(k.step)}${k.note ? ` · ${esc(k.note)}` : ''}</li>`).join('');
  return `<article class="run">
    ${head}
    <p>${esc(r.summary)}</p>
    ${goals ? `<h4>Цели</h4><ul class="goals">${goals}</ul>` : ''}
    ${findings ? `<h4>Находки</h4><ul class="findings">${findings}</ul>` : '<p class="ok">Находок нет.</p>'}
    ${known ? `<details><summary>Известное (${r.known.length})</summary><ul>${known}</ul></details>` : ''}
    <details><summary>Ход прохождения (${r.steps?.length ?? 0})</summary><ol class="steps">${steps}</ol></details>
    ${links}
  </article>`;
}

export function renderSite(dataDir, personas) {
  const sections = personas
    .map((p) => {
      const runs = listRuns(dataDir, p.id).slice(0, KEEP_RUNS);
      const sub = `${esc(p.device)} · ${esc(p.locale)} · ${esc(p.colorScheme ?? 'light')}`;
      const body = !isRunnable(p)
        ? '<p class="muted">Ждёт тестовых аккаунтов.</p>'
        : runs.length
          ? runs.map(renderRun).join('')
          : '<p class="muted">Ещё не запускался.</p>';
      return `<section class="persona"><h2>${esc(p.name)}</h2><div class="muted">${sub}</div>${body}</section>`;
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
.persona { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-top:16px; }
.run { border-top:1px solid var(--line); margin-top:14px; padding-top:12px; }
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
.finding img { display:block; max-width:100%; max-height:320px; margin-top:6px; border:1px solid var(--line); border-radius:6px; }
.links { display:flex; gap:14px; margin-top:10px; flex-wrap:wrap; } a { color:var(--accent); }
details summary { cursor:pointer; margin-top:10px; }
</style></head>
<body><main>
<h1>QA-агенты</h1>
<div class="muted">Последние ${KEEP_RUNS} прогона каждого персонажа. Обновлено ${esc(fmtDate(new Date().toISOString()))}.</div>
${sections}
</main>
<script>
for (const a of document.querySelectorAll('a.trace')) {
  a.href = 'trace-viewer/index.html?trace=' + encodeURIComponent(new URL(a.dataset.trace, location.href).href);
}
</script>
</body></html>`;
  writeFileSync(path.join(dataDir, 'index.html'), html);
}
