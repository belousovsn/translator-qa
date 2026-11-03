// Environment events: things that happen to a real user's device mid-session.
// The runner picks none, one or several at random from a seed, and the persona
// performs each one through its browser tools at the step the plan names.
// The seed is printed in the report so a run can be repeated.

/** Small deterministic PRNG, so the same seed gives the same plan. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EVENTS = {
  offline: {
    label: 'пропал интернет',
    how: [
      'Вызови browser_network_state_set с state "offline".',
      'Сделай одно-два обычных действия, как будто не заметил.',
      'Через 15–30 секунд (browser_wait_for с time) вызови browser_network_state_set с state "online".',
      'Посмотри, пришло ли приложение в понятное состояние, и повтори действие, которое не прошло.',
    ],
  },
  slow: {
    label: 'интернет резко замедлился',
    how: [
      'Вызови browser_run_code_unsafe с кодом:',
      '`async (page) => { await page.context().route("**/*", async (r) => { await new Promise((s) => setTimeout(s, 2500)); await r.continue(); }); return "slow"; }`',
      'Сделай три-четыре обычных действия на медленной сети, как сделал бы нетерпеливый человек.',
      'Верни скорость: browser_run_code_unsafe с кодом `async (page) => { await page.context().unroute("**/*"); return "fast"; }`.',
    ],
  },
  away: {
    label: 'отошёл на час',
    how: [
      'Вызови browser_run_code_unsafe с кодом:',
      '`async (page) => { await page.clock.install(); await page.clock.fastForward("01:00:00"); return "an hour later"; }`',
      'Продолжи с того же места, как человек, который вернулся к телефону через час.',
    ],
  },
  locked: {
    label: 'заблокировал телефон или ушёл в другое приложение',
    how: [
      'Вызови browser_run_code_unsafe с кодом:',
      '`async (page) => { const s = await page.context().newCDPSession(page); await s.send("Page.setWebLifecycleState", { state: "frozen" }); await new Promise((r) => setTimeout(r, 20000)); await s.send("Page.setWebLifecycleState", { state: "active" }); return "back"; }`',
      'Продолжи с того же места.',
    ],
  },
  'other-tab': {
    label: 'ушёл на другую вкладку и вернулся',
    how: [
      'Открой новую вкладку: browser_tabs с action "new", перейди в ней на https://example.com.',
      'Подожди 20 секунд (browser_wait_for с time).',
      'Вернись на вкладку приложения: browser_tabs с action "select" и её индексом.',
      'Продолжи с того же места.',
    ],
  },
  reopen: {
    label: 'закрыл вкладку и открыл ссылку заново',
    how: [
      'Запомни адрес текущей страницы приложения.',
      'Открой новую вкладку, перейди в ней на этот адрес, затем закрой старую вкладку (browser_tabs с action "close" и её индексом).',
      'Продолжи с того же места, если приложение это позволяет.',
    ],
  },
};

// How many events a run gets: none is a real day too.
const COUNT_WEIGHTS = [
  [0, 0.3],
  [1, 0.4],
  [2, 0.2],
  [3, 0.1],
];

/**
 * Picks the events for one persona run.
 * @returns {{ seed: number, events: { kind: string, afterStep: number }[] }}
 */
export function planEvents(seed) {
  const next = rng(seed);
  let roll = next();
  let count = 0;
  for (const [n, w] of COUNT_WEIGHTS) {
    if (roll < w) {
      count = n;
      break;
    }
    roll -= w;
  }
  const kinds = Object.keys(EVENTS);
  const events = [];
  for (let i = 0; i < count; i += 1) {
    const kind = kinds[Math.floor(next() * kinds.length)];
    const afterStep = 2 + Math.floor(next() * 12);
    events.push({ kind, afterStep });
  }
  events.sort((a, b) => a.afterStep - b.afterStep);
  return { seed, events, games: planGames(seed) };
}

/**
 * How this run treats games: a mock stand-in or the real ones, and which ways
 * out of a game to try. Drawn from its own stream so the events above stay
 * the same for a seed they already had.
 */
export function planGames(seed) {
  const next = rng(seed ^ 0x9e3779b9);
  const mode = next() < 0.6 ? 'mock' : 'real';
  const exits = ['complete', 'early', 'reload'];
  for (let i = exits.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [exits[i], exits[j]] = [exits[j], exits[i]];
  }
  return { mode, exits: exits.slice(0, mode === 'mock' ? 3 : 2) };
}

export function describePlan(plan) {
  if (plan.events.length === 0) {
    return 'В этом прогоне событий среды нет. Сам их не устраивай.';
  }
  const lines = [
    'В этом прогоне с устройством случится следующее. Выполни каждое событие примерно после указанного шага своего пути, даже если в этот момент что-то грузится. В отчёте отметь шаг события полем "event" с его кодом.',
    '',
  ];
  for (const e of plan.events) {
    const def = EVENTS[e.kind];
    lines.push(`**После шага ${e.afterStep}: ${def.label}** (код "${e.kind}")`);
    for (const h of def.how) lines.push(`- ${h}`);
    lines.push('');
  }
  lines.push('Других событий среды не устраивай.');
  return lines.join('\n');
}
