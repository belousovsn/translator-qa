// Mock games (#747). The persona's browser answers every game origin with one
// stand-in page instead of the real game. The stand-in speaks the host bridge
// (game:ready → translator:init, card practice, result, close, progress) and
// prints what the host sent, so a run checks the seams around games: which
// cards arrive, what the host does on a finished round, on an early exit and on
// a reload mid-game. The real games stay untouched; only this browser sees it.
//
// The runner writes mock-games.js and unmock-games.js into the run folder; the
// persona calls browser_run_code_unsafe with {"filename": "mock-games.js"}.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

// Labels are Russian: the page is a test tool, not part of the product.
const MOCK_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Мок игры</title>
<style>
body { margin:0; font:15px/1.45 system-ui, sans-serif; background:#fffbe6; color:#222; }
main { padding:16px; max-width:640px; margin:0 auto; }
h1 { font-size:18px; margin:0 0 4px; } .muted { color:#777; font-size:13px; }
.box { background:#fff; border:2px dashed #c9a400; border-radius:8px; padding:10px 12px; margin-top:10px; }
button { font:inherit; display:block; width:100%; margin-top:8px; padding:10px; border-radius:8px; border:1px solid #888; background:#fff; cursor:pointer; }
button.main { background:#222; color:#fff; border-color:#222; }
#log { font:12px/1.4 ui-monospace, monospace; white-space:pre-wrap; max-height:180px; overflow:auto; }
.bad { color:#b00; font-weight:600; } .ok { color:#070; }
</style></head>
<body><main>
<h1>Мок игры: <span id="game"></span></h1>
<div class="muted">Подставная страница QA-агента вместо настоящей игры. Её вид не оценивается.</div>
<div class="box" id="init">Жду translator:init…</div>
<div class="box">
  <button class="main" id="complete">Доиграть: ответить на все карточки и завершить</button>
  <button id="half">Ответить на половину и выйти</button>
  <button id="early">Выйти сразу, без результата</button>
  <button id="progress">Сохранить и прочитать прогресс</button>
</div>
<div class="box"><strong>Сообщения</strong><div id="log"></div></div>
</main>
<script>
const GAME = location.hostname.replace(/^test\\./, '').replace(/\\.memdecks\\.com$/, '');
document.getElementById('game').textContent = GAME;
const logEl = document.getElementById('log');
const log = (s) => { logEl.textContent += new Date().toLocaleTimeString() + ' ' + s + '\\n'; logEl.scrollTop = 1e9; };
const send = (m) => { parent.postMessage(m, '*'); log('→ ' + m.type + (m.practice ? ' ' + m.practice.cardId.slice(0, 8) + (m.practice.correct ? ' верно' : ' ошибка') : '')); };
let init = null;
let req = 0;
const timer = setTimeout(() => {
  if (!init) document.getElementById('init').innerHTML = '<span class="bad">translator:init не пришёл за 10 секунд</span>';
}, 10000);
addEventListener('message', async (e) => {
  const d = e.data || {};
  if (!d.type) return;
  log('← ' + d.type + (d.ok === false ? ' ok:false ' + (d.error || '') : ''));
  if (d.type !== 'translator:init') return;
  clearTimeout(timer);
  init = d;
  const cards = Array.isArray(d.cards) ? d.cards : null;
  const rows = [
    ['карточек в init', cards ? cards.length : 'нет поля cards'],
    ['язык изучения', d.targetLang || '—'],
    ['свой язык', d.sourceLang || '—'],
    ['язык интерфейса', d.uiLocale || '—'],
    ['цель запуска', (d.launchContext && d.launchContext.purpose) || 'обычный'],
    ['gameToken', d.gameToken ? 'есть' : 'нет'],
    ['сессия Supabase', d.accessToken ? 'есть' : 'нет'],
    ['возможности', Object.keys(d.capabilities || {}).filter((k) => d.capabilities[k]).join(', ') || '—'],
  ];
  const box = document.getElementById('init');
  box.innerHTML = rows.map(([k, v]) => '<div>' + k + ': <strong>' + v + '</strong></div>').join('') + '<div id="api">Проверяю /api/cards…</div>';
  const api = document.getElementById('api');
  const token = d.gameToken || d.accessToken;
  if (!token || !d.apiBase) { api.innerHTML = '<span class="bad">нечем проверить /api/cards</span>'; return; }
  try {
    const r = await fetch(d.apiBase + '/api/cards', { headers: { Authorization: 'Bearer ' + token } });
    const body = r.ok ? await r.json() : null;
    const n = Array.isArray(body) ? body.length : body && Array.isArray(body.cards) ? body.cards.length : '?';
    api.innerHTML = r.ok ? '<span class="ok">/api/cards: ' + r.status + ', карточек ' + n + '</span>' : '<span class="bad">/api/cards: ' + r.status + '</span>';
  } catch (err) {
    api.innerHTML = '<span class="bad">/api/cards: ' + err.message + '</span>';
  }
});
function practice(list) {
  list.forEach((c, i) => send({ type: 'game:card-practiced', practice: { cardId: c.cardId, correct: i % 4 !== 3, attemptId: 'mock-' + Date.now() + '-' + i } }));
}
document.getElementById('complete').onclick = () => {
  const cards = (init && init.cards) || [];
  practice(cards);
  const correct = cards.filter((_, i) => i % 4 !== 3).length;
  send({ type: 'game:result', result: { mock: true, total: cards.length, correct } });
};
document.getElementById('half').onclick = () => {
  const cards = (init && init.cards) || [];
  practice(cards.slice(0, Math.ceil(cards.length / 2)));
  send({ type: 'game:close' });
};
document.getElementById('early').onclick = () => send({ type: 'game:close' });
document.getElementById('progress').onclick = () => {
  send({ type: 'game:save-progress', requestId: ++req, slot: 'qa_mock', version: 1, state: { at: Date.now() } });
  setTimeout(() => send({ type: 'game:load-progress', requestId: ++req, slot: 'qa_mock' }), 800);
};
send({ type: 'game:ready' });
</script>
</body></html>`;

/** Code for browser_run_code_unsafe: route every game origin to the stand-in. */
export function mockGamesCode(baseUrl) {
  return `async (page) => {
  const res = await page.request.get(${JSON.stringify(`${baseUrl}/api/settings`)});
  const games = (await res.json()).games || [];
  const origins = [...new Set(games.map((g) => new URL(g.url).origin))];
  const html = ${JSON.stringify(MOCK_HTML)};
  const ctx = page.context();
  ctx.__qaMock = ctx.__qaMock || [];
  for (const origin of origins) {
    const pattern = origin + '/**';
    const handler = (route) => route.request().resourceType() === 'document'
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      : route.abort();
    await ctx.route(pattern, handler);
    ctx.__qaMock.push([pattern, handler]);
  }
  return 'игры подменены моком: ' + games.map((g) => g.name).join(', ');
}`;
}

export const UNMOCK_CODE = `async (page) => {
  const ctx = page.context();
  for (const [pattern, handler] of ctx.__qaMock || []) await ctx.unroute(pattern, handler);
  ctx.__qaMock = [];
  return 'настоящие игры возвращены';
}`;

export function writeMockFiles(runDir, baseUrl) {
  writeFileSync(path.join(runDir, 'mock-games.js'), mockGamesCode(baseUrl));
  writeFileSync(path.join(runDir, 'unmock-games.js'), UNMOCK_CODE);
}

export const GAME_EXITS = {
  complete: 'доиграть до конца: в моке кнопка «Доиграть», в настоящей игре пройти раунд',
  early: 'выйти раньше: в моке «Выйти сразу» или «Ответить на половину и выйти», в настоящей игре закрыть её кнопкой выхода хоста',
  reload: 'выйти обновлением страницы посреди игры: browser_navigate на текущий адрес приложения, пока игра открыта',
};

/** The games section of the persona prompt. */
export function describeGames(games) {
  const exits = games.exits.map((k, i) => `${i + 1}. ${GAME_EXITS[k]} (код "game-${k}")`).join('\n');
  const mock = games.mode === 'mock'
    ? `В этом прогоне игры подменены моком. Сразу после browser_start_tracing вызови browser_run_code_unsafe с {"filename": "mock-games.js"}. Вместо игры откроется жёлтая страница «Мок игры»: она показывает, что прислало приложение (сколько карточек, языки, токен, ответ /api/cards), и даёт кнопки выхода. Вид самой мок-страницы не оценивай. Оценивай приложение вокруг неё: совпадает ли число карточек в моке с тем, что приложение обещало перед запуском; что приложение показывает после результата, после раннего выхода и после обновления; обновился ли прогресс карточек в Коллекции после «Доиграть»; не осталось ли зависшего оверлея или игры, которая «продолжается» после выхода. Если нужна настоящая игра, вызови browser_run_code_unsafe с {"filename": "unmock-games.js"}.`
    : 'В этом прогоне игры настоящие.';
  return `# Игры

${mock}

Запусти игры столько раз, сколько нужно, чтобы выйти из них такими способами, по порядку:
${exits}

Отметь шаг каждого выхода в отчёте полем "event" с его кодом. После каждого выхода проверь, что приложение в понятном состоянии и что можно запустить игру снова.`;
}
