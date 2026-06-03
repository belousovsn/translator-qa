import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { TEST_BASE_URL } from '../src/config.js'

/**
 * Lazily build a Supabase client using the PUBLIC anon config exposed by the
 * app at `/api/settings`. This is intentionally lazy (not a top-level await) so
 * importing this module — e.g. during `playwright test --list` or when running
 * only the unauthenticated suite — never triggers a network request.
 */
let cached: SupabaseClient | null = null

export async function getSupabase(): Promise<SupabaseClient> {
    if (cached) return cached

    const res = await fetch(new URL('/api/settings', TEST_BASE_URL))
    if (!res.ok) {
        throw new Error('Failed to load settings')
    }
    const data = await res.json()
    if (!data.SUPABASE_URL) {
        throw new Error('SUPABASE_URL is missing')
    }
    if (!data.SUPABASE_KEY) {
        throw new Error('SUPABASE_KEY is missing')
    }

    cached = createClient(data.SUPABASE_URL, data.SUPABASE_KEY)
    return cached
}
