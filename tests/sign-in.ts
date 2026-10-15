import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase answers an occasional sign-in with a 502-504, which supabase-js raises as
 * `AuthRetryableFetchError`. The next attempt succeeds; the nightly run failed on it
 * (12 Sep 2026, account_merge). Everything else, a wrong password included, is returned
 * on the first try.
 */
const RETRY_DELAYS_MS = [1_000, 3_000]

export async function signInWithPassword(client: SupabaseClient, email: string, password: string) {
    let result = await client.auth.signInWithPassword({ email, password })
    for (const delay of RETRY_DELAYS_MS) {
        if (!result.error || !isAuthRetryableFetchError(result.error)) break
        await new Promise((resolve) => setTimeout(resolve, delay))
        result = await client.auth.signInWithPassword({ email, password })
    }
    return result
}
