// Browser check of the mock game (not part of `npm run check`: needs Chromium).
// A fake host page embeds a fake game origin; the mock code routes that origin
// to the stand-in, the host answers game:ready with translator:init, and we
// read back what the stand-in sent for each way out.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mockGamesCode, UNMOCK_CODE } from '../lib/game-mock.mjs';
import { planGames } from '../lib/events.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HOST = 'https://test.memdecks.com';
const GAME = 'https://test.wordquiz.memdecks.com';
const hostHtml = `<!doctype html><body><iframe id="g" src="${GAME}/" style="width:400px;height:600px"></iframe><script>
window.got = [];
addEventListener('message', (e) => {
  window.got.push({ origin: e.origin, data: e.data });
  if (e.data?.type === 'game:ready') document.getElementById('g').contentWindow.postMessage({
    type: 'translator:init', apiBase: location.origin, targetLang: 'hy', uiLocale: 'ru', sourceLang: 'ru',
    gameToken: 'tkn', capabilities: { cardPractice: true, progress: true },
    cards: [1,2,3,4,5,6,7,8].map((n) => ({ cardId: 'card-000' + n, wordId: n })),
  }, '*');
});
</script></body>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const ctx = page.context();
// The fake host stands in for the app: its page, /api/settings and /api/cards.
await ctx.route(`${HOST}/**`, (r) => {
  const u = new URL(r.request().url());
  if (u.pathname === '/api/settings') return r.fulfill({ json: { games: [{ name: 'word-quiz-test', url: GAME }] } });
  if (u.pathname === '/api/cards') return r.fulfill({ json: [{}, {}, {}], headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' } });
  return r.fulfill({ contentType: 'text/html', body: hostHtml });
});
const settle = (n) => page.waitForFunction((k) => window.got.length >= k, n);
const run = (code) => new Function(`return (${code})`)()(page);

console.log(await run(mockGamesCode(HOST)));
await page.goto(`${HOST}/`);
const frame = page.frameLocator('#g');
await frame.getByText('карточек в init: 8').waitFor();
await frame.getByText('/api/cards: 200, карточек 3').waitFor();

await page.evaluate(() => { window.got = []; });
await frame.getByRole('button', { name: /Доиграть/ }).click();
await settle(9);
let got = await page.evaluate(() => window.got.map((m) => m.data.type));
assert.equal(got.filter((t) => t === 'game:card-practiced').length, 8);
assert.equal(got.at(-1), 'game:result');
const origins = await page.evaluate(() => [...new Set(window.got.map((m) => m.origin))]);
assert.deepEqual(origins, [GAME], 'messages come from the game origin, as the host expects');

await page.evaluate(() => { window.got = []; });
await frame.getByRole('button', { name: /половину/ }).click();
await settle(5);
got = await page.evaluate(() => window.got.map((m) => m.data.type));
assert.deepEqual(got, [...Array(4).fill('game:card-practiced'), 'game:close']);

await page.evaluate(() => { window.got = []; });
await frame.getByRole('button', { name: /Выйти сразу/ }).click();
await settle(1);
assert.deepEqual(await page.evaluate(() => window.got.map((m) => m.data.type)), ['game:close']);

console.log(await run(UNMOCK_CODE));
assert.equal((ctx.__qaMock ?? []).length, 0);
await browser.close();

for (const seed of [1, 2, 3, 42]) {
  const g = planGames(seed);
  assert.ok(['mock', 'real'].includes(g.mode));
  assert.equal(new Set(g.exits).size, g.exits.length);
}
console.log('game mock ok');
