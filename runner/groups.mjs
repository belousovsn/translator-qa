/**
 * The ONLY test selections a visitor is allowed to trigger.
 *
 * Each entry maps a stable group id to a FIXED array of Playwright CLI args.
 * Requests are matched against these ids only — no visitor input is ever
 * concatenated into the command line, so there is no injection surface.
 */
export const GROUPS = {
  unauth: {
    label: 'Unauthenticated UI',
    description:
      'Translator page on load: input, on-screen keyboard, section visibility. Backend calls are route-mocked for determinism.',
    args: ['--project=chromium', 'tests/unauth'],
    auth: false,
    kinds: ['e2e', 'smoke'],
  },
  translation: {
    label: 'Translation flow',
    description:
      'English → Armenian / Greek translation, suggestions, enrichment and TTS button states (mocked translate API).',
    args: ['--project=chromium', 'tests/translation'],
    auth: false,
    kinds: ['e2e', 'regression'],
  },
  onboarding: {
    label: 'Onboarding',
    description:
      'Guest-reachable onboarding: quest chip progress, first-card spotlight, milestone hooks.',
    args: ['--project=chromium', 'tests/onboarding'],
    auth: false,
    kinds: ['e2e', 'regression'],
  },
  api: {
    label: 'API contract',
    description:
      'Server API checks: /api/translate validation, /api/settings shape, account-merge guards. Admin tests auto-skip without a key.',
    args: ['--project=chromium', 'tests/api'],
    auth: false,
    kinds: ['api', 'integration'],
  },
  auth: {
    label: 'Authenticated journeys',
    description:
      'Signs in with a disposable test account: add a card, Words Pump queue flow, authenticated milestones. Cleans up afterwards.',
    args: ['--project=auth-tests'],
    auth: true,
    kinds: ['e2e', 'integration'],
  },
};

/** Public, serialisable view of the groups for the UI (no internal args). */
export function publicGroups() {
  return Object.entries(GROUPS).map(([id, g]) => ({
    id,
    label: g.label,
    description: g.description,
    auth: g.auth,
    kinds: g.kinds ?? [],
  }));
}
