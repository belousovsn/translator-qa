# translator-qa

End-to-end and API test suite for **MemDecks / Translator** — a language-learning app
(translation, saved vocabulary cards, onboarding, and mini-games). The suite is written in
**TypeScript + Playwright**, uses the **Page Object Model**, and runs against the deployed
test environment at `https://test.memdecks.com`.

This repository is intentionally standalone and public: the application code stays private,
while the tests are open as a demonstration of how the product is verified — UI flows,
authenticated journeys, asynchronous/mocked backend behaviour, and API contract checks.

> No secrets live in this repo. Credentials and the base URL are supplied via environment
> variables (see [`.env.example`](.env.example)). The signing-in suites use a **dedicated,
> disposable test account** and clean up after themselves.

## What it covers

| Suite | Path | What it checks | Needs sign-in? |
| --- | --- | --- | --- |
| Translator UI (unauth) | `tests/unauth/translator.spec.ts` | Input, on-screen keyboard, initial section visibility; auto-translate blocked via route mocking for deterministic load | No |
| Post-sign-in content load | `tests/unauth/sign_in_content_load.spec.ts` | Library + collection render immediately after signing in; backend responses mocked | Yes |
| Translation | `tests/translation/translate_english_word.spec.ts` | English-word translation flow and panel behaviour | Mixed |
| Onboarding | `tests/onboarding/*.spec.ts` | Milestones, quest, and spotlight onboarding flows | Mixed |
| Authenticated journeys | `tests/auth/*.spec.ts` | Positive flow, Words Pump queue flow, authenticated onboarding milestones | Yes |
| Server API examples | `tests/api/server_api_examples.spec.ts` | `/api/translate` validation, `/api/settings` shape, admin card translations (admin tests auto-skip without `ADMIN_API_KEY`) | Partly |
| Account merge (smoke) | `tests/api/account_merge.spec.ts` | Guest→permanent account card merge: validation/security always; full round-trip auto-skips until enabled server-side | Yes |
| Cross-language translate (smoke) | `tests/api/cards_translate.spec.ts` | `POST /api/cards/translate` scoped-card-token contract (backs the games SDK's `ctx.translate`): bearer-token validation always; live lookup auto-skips without `ADMIN_API_KEY` or server-side game-token signing | Mixed |

## Layout

```
src/
  types.ts        # API/domain types (mirrors the app's public shapes; decoupled from the app repo)
  config.ts       # dotenv loader + validated env access (TEST_BASE_URL, credentials, ADMIN_API_KEY)
page_objects/     # Page Object Model: auth modal, translator, dictionary, onboarding
tests/
  unauth/         # no authentication required (or sign-in with all backend calls mocked)
  translation/    # translation flows
  onboarding/     # onboarding flows
  auth/           # authenticated journeys (use the disposable account)
  api/            # API-level contract & smoke tests
  mocks/          # shared response fixtures used to make UI tests deterministic
  auth.setup.ts          # Playwright setup project: signs in once, saves storage state
  cardsCleanup.setup.ts  # teardown project: deletes the test account's cards, clears session
  supabase-client.ts     # lazy Supabase client built from the app's PUBLIC /api/settings
playwright.config.ts     # projects: auth-setup, cards-auth-cleanup, auth-tests, chromium
```

The Playwright **projects** map to how you'd select tests:

- `chromium` — everything except `auth/` (the safe, mostly unauthenticated tests).
- `auth-tests` — authenticated journeys; depends on `auth-setup` and runs the
  `cards-auth-cleanup` teardown afterwards.

## Getting started

Requires **Node 20+**.

```bash
npm install
npm run pw:install          # download the Chromium browser Playwright drives

cp .env.example .env        # then edit .env with a disposable test account
```

Fill in `.env`:

```
TEST_BASE_URL=https://test.memdecks.com
TEST_EMAIL=your-disposable-test-account@example.com
TEST_PASSWORD=...
ADMIN_API_KEY=              # optional; admin API tests skip without it
```

## Running

```bash
npm run test          # full suite
npm run test:safe     # unauth + API only (no auth state needed for unauth)
npm run test:auth     # authenticated journeys (uses the disposable account)
npm run test:ui       # Playwright UI mode
npm run test:headed   # headed browser
npm run report        # open the last HTML report
npm run codegen       # record a new test against TEST_BASE_URL
npm run typecheck     # tsc --noEmit
```

`test:safe`'s unauthenticated tests need no credentials. The authenticated tests sign in
with the `.env` account and the `cards-auth-cleanup` teardown removes any cards they create.

## Continuous integration

[`.github/workflows/e2e.yml`](.github/workflows/e2e.yml) runs the suite on a nightly
schedule and on manual dispatch, against `TEST_BASE_URL`, and uploads the Playwright HTML
report as an artifact. Configure these repository secrets: `TEST_BASE_URL`, `TEST_EMAIL`,
`TEST_PASSWORD`, and (optionally) `ADMIN_API_KEY`.

## Roadmap

This suite is the foundation for a **"Live QA Lab"** on
[my portfolio](https://github.com/) — a guarded runner that lets visitors trigger a
curated subset of these tests against the live test environment and watch the results
stream in, with a link to the full Playwright report.
