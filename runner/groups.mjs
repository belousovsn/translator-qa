/**
 * The ONLY test selections a visitor is allowed to trigger.
 *
 * Each entry maps a stable group id to a FIXED array of Playwright CLI args.
 * Requests are matched against these ids only — no visitor input is ever
 * concatenated into the command line, so there is no injection surface.
 *
 * `category` buckets the groups for the UI (which renders them under headers in
 * this declaration order — so "Smoke" comes first). `kinds` are the free-form
 * test-type tags shown as chips. `timeoutMs`, when set, overrides the runner's
 * default per-run kill timeout (used for the slower live-service feature runs).
 */

/** Category labels, in the order the UI should present them. */
export const CATEGORIES = {
  smoke: 'Smoke',
  guest: 'E2E · Unauthenticated',
  authed: 'E2E · Authenticated',
  feature: 'Feature-driven',
};

export const GROUPS = {
  // ── Smoke ────────────────────────────────────────────────────────────────
  smoke: {
    label: 'Smoke suite',
    category: 'smoke',
    description:
      'A fast cross-section run first: the app loads, a word translates, onboarding appears, and the public API contracts hold. All guest-side and route-mocked — no sign-in.',
    // Tests tagged @smoke across the guest + API specs (chromium project skips
    // tests/auth). Keep this in step with the `{ tag: "@smoke" }` annotations.
    args: ['--project=chromium', '--grep', '@smoke'],
    auth: false,
    kinds: ['smoke', 'e2e', 'api'],
  },

  // ── E2E · Unauthenticated ─────────────────────────────────────────────────
  unauth: {
    label: 'Translator UI',
    category: 'guest',
    description:
      'Translator page on load: input, on-screen keyboard, section visibility. Backend calls are route-mocked for determinism.',
    args: ['--project=chromium', 'tests/unauth'],
    auth: false,
    kinds: ['e2e', 'smoke'],
  },
  translation: {
    label: 'Translation flow',
    category: 'guest',
    description:
      'English → Armenian / Greek translation, suggestions, enrichment and TTS button states (mocked translate API).',
    args: ['--project=chromium', 'tests/translation'],
    auth: false,
    kinds: ['e2e', 'regression'],
  },
  onboarding: {
    label: 'Onboarding',
    category: 'guest',
    description:
      'Guest-reachable onboarding: quest chip progress, first-card spotlight, milestone hooks.',
    args: ['--project=chromium', 'tests/onboarding'],
    auth: false,
    kinds: ['e2e', 'regression'],
  },

  // ── E2E · Authenticated ───────────────────────────────────────────────────
  auth: {
    label: 'Authenticated journeys',
    category: 'authed',
    description:
      'Signs in with a disposable test account: add a card, Words Pump queue flow, authenticated onboarding milestones. Cleans up afterwards.',
    // Scoped to the core signed-in journeys — the slower feature specs in
    // tests/auth get their own groups below.
    args: [
      '--project=auth-tests',
      'tests/auth/positive_flow.spec.ts',
      'tests/auth/pump_flow.spec.ts',
      'tests/auth/onboarding_milestones_auth.spec.ts',
    ],
    auth: true,
    kinds: ['e2e', 'integration'],
    timeoutMs: 240000,
  },

  // ── Feature-driven ────────────────────────────────────────────────────────
  lobby: {
    label: 'Multiplayer lobby',
    category: 'feature',
    description:
      'Live lobby over socket.io: matchmaking choices, solo launch + Back, quick-match cancel, room create/join, and a real two-player match between players studying different languages.',
    args: ['--project=auth-tests', 'tests/auth/lobby.spec.ts'],
    auth: true,
    kinds: ['e2e', 'feature', 'realtime'],
    timeoutMs: 300000,
  },
  focus: {
    label: 'Focused learning',
    category: 'feature',
    description:
      'Game study set: the card picker filters a mixed-language collection to the current study language, persists per language, and drives the focused-cards game resolver.',
    args: ['--project=auth-tests', 'tests/auth/focused_learning.spec.ts'],
    auth: true,
    kinds: ['e2e', 'feature'],
    timeoutMs: 240000,
  },
  api: {
    label: 'API contracts',
    category: 'feature',
    description:
      'Server API checks: /api/translate validation, /api/settings shape, cross-language games resolver + card translate, account-merge guards. Admin/full-path tests auto-skip without a key.',
    args: ['--project=chromium', 'tests/api'],
    auth: false,
    kinds: ['api', 'contract', 'integration'],
  },
};

/** Public, serialisable view of the groups for the UI (no internal args). */
export function publicGroups() {
  return Object.entries(GROUPS).map(([id, g]) => ({
    id,
    label: g.label,
    category: g.category,
    categoryLabel: CATEGORIES[g.category] ?? g.category,
    description: g.description,
    auth: g.auth,
    kinds: g.kinds ?? [],
  }));
}
