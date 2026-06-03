import 'dotenv/config'

/**
 * Central, validated access to the environment this suite runs against.
 *
 * No credentials are ever hardcoded in the repo — they come from `.env`
 * (gitignored) or CI secrets. See `.env.example`.
 */

/** Base URL of the deployed app under test. */
export const TEST_BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'

/** Optional admin API key. Admin-only API tests auto-skip when this is empty. */
export const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? ''

/**
 * Disposable test-account credentials. May be empty strings when no `.env` is
 * present (e.g. during `playwright test --list` or type-checking) — reading
 * these at module top level therefore never throws. Tests that actually sign in
 * should call {@link requireTestCredentials} at runtime for a clear failure.
 */
export const TEST_EMAIL = process.env.TEST_EMAIL ?? ''
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? ''

/**
 * Returns the disposable test-account credentials, or throws a clear error if
 * they are not configured. Call this from inside a test/setup body (runtime),
 * never at module top level, so the suite can still be listed without `.env`.
 */
export function requireTestCredentials(): { email: string; password: string } {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error(
      'Missing TEST_EMAIL / TEST_PASSWORD. Copy .env.example to .env and set a ' +
        'dedicated, disposable test account (see README).',
    )
  }
  return { email: TEST_EMAIL, password: TEST_PASSWORD }
}
