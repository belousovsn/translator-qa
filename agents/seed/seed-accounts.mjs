#!/usr/bin/env node
// Gives the QA personas' test accounts a lived-in state (#747), through the
// same API a user's browser calls. Run once per account; a second run skips an
// account that already has its cards, so the accounts keep living their own
// life between runs instead of being reset.
//
//   node seed/seed-accounts.mjs                 every account
//   node seed/seed-accounts.mjs veteran         one account
//   options: --force   seed even when the account already has cards
//
// Reads emails and passwords from QA_AGENTS_SECRETS (default
// /var/lib/qa-agents/secrets.env); never prints a password.

import { readFileSync } from 'node:fs';

const BASE = (process.env.TEST_BASE_URL ?? 'https://test.memdecks.com').replace(/\/$/, '');
const SECRETS = process.env.QA_AGENTS_SECRETS ?? '/var/lib/qa-agents/secrets.env';
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

const secrets = Object.fromEntries(
  readFileSync(SECRETS, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

// What each account should look like after seeding.
const ACCOUNTS = {
  veteran: {
    key: 'VETERAN',
    base: 'ru',
    study: 'hy',
    name: 'Сергей',
    decks: 'all',
    minCards: 320,
    // Own decks come through Anki import in the app; POST /api/decks is not used by the client.
    ownDecks: [],
    scoreShare: 0.7,
  },
  signin: { key: 'SIGNIN', base: 'ru', study: 'hy', name: 'Лиана', decks: 1, ownDecks: [], scoreShare: 0.3 },
  'pair-a': { key: 'PAIR_A', base: 'ru', study: 'hy', name: 'Артём', decks: 2, ownDecks: [], scoreShare: 0.5 },
  'pair-b': { key: 'PAIR_B', base: 'ru', study: 'el', name: 'Мила', decks: 2, ownDecks: [], scoreShare: 0.5 },
};

const log = (...m) => console.log(...m);
let settings;

async function signIn(email, password) {
  settings ??= await (await fetch(`${BASE}/api/settings`)).json();
  const res = await fetch(`${settings.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: settings.SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`sign-in failed for ${email}: ${res.status} ${body.error_description ?? body.msg ?? ''}`);
  return body.access_token;
}

function api(token) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${String(text).slice(0, 200)}`);
    return data;
  };
}

/** The profile choices the client keeps in user_metadata. */
async function setProfile(token, a) {
  const res = await fetch(`${settings.SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: settings.SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data: { main_language: a.study, base_language: a.base, ui_locale: a.base, email_locale: a.base, full_name: a.name } }),
  });
  if (!res.ok) throw new Error(`profile: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const cardsOf = async (call) => {
  const c = await call('GET', '/api/cards');
  return Array.isArray(c) ? c : c.cards ?? [];
};

async function seed(id, a) {
  const email = secrets[`QA_${a.key}_EMAIL`];
  const password = secrets[`QA_${a.key}_PASSWORD`];
  if (!email || !password) throw new Error(`${id}: no QA_${a.key}_EMAIL/PASSWORD in ${SECRETS}`);
  const token = await signIn(email, password);
  const call = api(token);
  const before = await cardsOf(call);
  if (before.length && !force) {
    log(`${id}: already has ${before.length} cards, skipped`);
    return;
  }
  await setProfile(token, a);
  await call('PATCH', '/api/user', { name: a.name }).catch((e) => log(`${id}: name: ${e.message}`));
  await call('POST', '/api/library/initialize', { targetLang: a.study }).catch((e) => log(`${id}: initialize: ${e.message}`));

  const decks = await call('GET', `/api/library/starter-decks?targetLang=${a.study}&sourceLang=${a.base}`);
  const chosen = (Array.isArray(decks) ? decks : []).slice(0, a.decks === 'all' ? undefined : a.decks);
  for (const d of chosen) {
    try {
      await call('POST', '/api/library/starter-decks/import', { deckSlug: d.slug, sourceLang: a.base, targetLang: a.study });
      log(`${id}: deck ${d.slug} (${d.cardCount})`);
    } catch (e) {
      log(`${id}: deck ${d.slug} failed: ${e.message}`);
    }
  }

  // Topic packs top a big account up: starter decks for one pair hold about a hundred words.
  if (a.minCards) {
    const packs = await call('GET', `/api/library/packs?targetLang=${a.study}`).catch(() => []);
    for (const p of Array.isArray(packs) ? packs : []) {
      if ((await cardsOf(call)).length >= a.minCards) break;
      const slug = p.slug ?? p.pack_slug;
      try {
        await call('POST', '/api/library/subscribe', { packSlug: slug, targetLang: a.study });
        for (let i = 0; i < 3 && (await cardsOf(call)).length < a.minCards; i += 1) {
          await call('POST', '/api/library/advance-tier', { packSlug: slug, targetLang: a.study }).catch(() => {});
        }
        log(`${id}: pack ${slug}, now ${(await cardsOf(call)).length} cards`);
      } catch (e) {
        log(`${id}: pack ${slug} failed: ${e.message}`);
      }
    }
  }

  for (const own of a.ownDecks) {
    try {
      const deck = await call('POST', '/api/decks', { title: own.title, sourceLang: a.base });
      const deckId = deck.id ?? deck.deck?.id;
      await call('PATCH', `/api/decks/${deckId}/languages`, { sourceLang: a.base, targetLang: a.study }).catch((e) => log(`${id}: languages: ${e.message}`));
      let added = 0;
      for (const lemma of own.lemmas) {
        await call('POST', `/api/decks/${deckId}/cards`, { lemma, partOfSpeech: 'noun' }).then(() => (added += 1), (e) => log(`${id}: ${lemma}: ${e.message}`));
      }
      if (own.toCollection) await call('POST', `/api/decks/${deckId}/collection`, {}).catch((e) => log(`${id}: to collection: ${e.message}`));
      log(`${id}: own deck "${own.title}", ${added} words${own.toCollection ? ', in collection' : ''}`);
    } catch (e) {
      log(`${id}: own deck "${own.title}" failed: ${e.message}`);
    }
  }

  // Progress: most cards practised a little, a few learned, the rest untouched.
  const cards = await cardsOf(call);
  const scores = cards
    .filter((_, i) => (i * 7919) % 100 < a.scoreShare * 100)
    .map((c, i) => ({ cardId: c.id, score: i % 9 === 0 ? 100 : 5 + ((i * 37) % 70) }));
  for (let i = 0; i < scores.length; i += 100) {
    await call('POST', '/api/cards/scores', { scores: scores.slice(i, i + 100) }).catch((e) => log(`${id}: scores: ${e.message}`));
  }
  log(`${id}: ${cards.length} cards, ${scores.length} with progress`);
}

for (const [id, a] of Object.entries(ACCOUNTS)) {
  if (only.length && !only.includes(id)) continue;
  try {
    await seed(id, a);
  } catch (e) {
    console.error(`${id}: ${e.message}`);
    process.exitCode = 1;
  }
}
