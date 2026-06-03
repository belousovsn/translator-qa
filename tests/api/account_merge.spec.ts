import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Card, Translation } from '../../src/types.js'
import { TEST_EMAIL, TEST_PASSWORD } from '../../src/config.js'
// Words to try when planting a guest card — we pick one the permanent account
// does not already own so the merge moves it (rather than de-duping it away).
const MERGE_WORDS = ['umbrella', 'mountain', 'river', 'forest', 'window', 'bridge']

let supabaseUrl = ''
let supabaseKey = ''

async function loadCreds(request: APIRequestContext): Promise<void> {
    if (supabaseUrl && supabaseKey) return
    const res = await request.get('/api/settings')
    const body = await res.json() as { SUPABASE_URL?: string; SUPABASE_KEY?: string }
    supabaseUrl = body.SUPABASE_URL ?? ''
    supabaseKey = body.SUPABASE_KEY ?? ''
    expect(supabaseUrl, 'SUPABASE_URL from /api/settings').toBeTruthy()
    expect(supabaseKey, 'SUPABASE_KEY from /api/settings').toBeTruthy()
}

// A throwaway client that never persists its session, so parallel specs sharing
// a worker can't clobber each other's auth state.
function isolatedClient(): SupabaseClient {
    return createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
}

async function signInPermanent(): Promise<{ token: string; id: string }> {
    const client = isolatedClient()
    const { data, error } = await client.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    })
    expect(error).toBeNull()
    expect(data.session?.access_token).toBeTruthy()
    return { token: data.session?.access_token ?? '', id: data.user?.id ?? '' }
}

async function fetchTranslation(
    request: APIRequestContext,
    word: string,
): Promise<Translation | null> {
    const response = await request.post('/api/translate', {
        data: { word, selectedSourceLang: 'en', selectedTargetLang: 'hy' },
    })
    return response.ok() ? await response.json() as Translation : null
}

async function getCardWords(request: APIRequestContext, token: string): Promise<Set<string>> {
    const res = await request.get('/api/cards', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.ok()).toBeTruthy()
    const rows = await res.json() as Array<{ source_word?: string }>
    return new Set(rows.map((r) => r.source_word?.trim().toLowerCase()).filter(Boolean) as string[])
}

test.describe('POST /api/account/merge', () => {
    // ---- Always-on validation & security (no feature flags required) ----

    test('rejects an unauthenticated request', async ({ request }) => {
        const res = await request.post('/api/account/merge', { data: { anonAccessToken: 'x' } })
        expect(res.status()).toBe(401)
    })

    test('requires anonAccessToken in the body', async ({ request }) => {
        await loadCreds(request)
        const { token } = await signInPermanent()

        const res = await request.post('/api/account/merge', {
            headers: { Authorization: `Bearer ${token}` },
            data: {},
        })
        expect(res.status()).toBe(400)
        expect((await res.json()).error).toBe('anonAccessToken is required')
    })

    test('refuses to merge from a non-anonymous source (anti-siphon guard)', async ({ request }) => {
        await loadCreds(request)
        const { token } = await signInPermanent()

        // Hand a permanent account's own token as the "anonymous" source. This is
        // the abuse vector — pulling a real account's data — and must be refused.
        const res = await request.post('/api/account/merge', {
            headers: { Authorization: `Bearer ${token}` },
            data: { anonAccessToken: token },
        })
        expect(res.status()).toBe(400)
        expect((await res.json()).error).toMatch(/anonymous/i)
    })

    // ---- Full round-trip (auto-skips until anon sign-ins + migration 009 live) ----

    test('moves a guest card into the signed-in account', async ({ request }) => {
        await loadCreds(request)

        // Create a guest. Skips cleanly if anonymous sign-ins aren't enabled yet.
        const anonClient = isolatedClient()
        const { data: anon, error: anonError } = await anonClient.auth.signInAnonymously()
        test.skip(Boolean(anonError), `anonymous sign-ins unavailable: ${anonError?.message ?? ''}`)
        const anonToken = anon.session?.access_token ?? ''
        const anonId = anon.user?.id ?? ''
        expect(anonToken).toBeTruthy()

        const { token: destToken, id: destId } = await signInPermanent()
        expect(anonId).not.toBe(destId)

        let cardId: string | null = null
        try {
            // Pick a word the permanent account doesn't already have.
            const owned = await getCardWords(request, destToken)
            let card: Card | null = null
            for (const word of MERGE_WORDS) {
                if (owned.has(word)) continue
                const translation = await fetchTranslation(request, word)
                if (!translation) continue
                card = {
                    id: crypto.randomUUID(),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    ...(translation.wordId !== undefined ? { wordId: translation.wordId } : {}),
                    languagePair: ['en', 'hy'],
                    translation,
                    imageUrlSmall: 'https://example.com/test-small.png',
                    imageUrlLarge: 'https://example.com/test-large.png',
                    ttsFile: translation.ttsFile ?? '',
                }
                break
            }
            expect(card, 'a candidate word not already owned by the test account').toBeTruthy()
            cardId = card!.id

            // Save it as the guest.
            const save = await request.post('/api/cards/save', {
                headers: { Authorization: `Bearer ${anonToken}` },
                data: card,
            })
            expect(save.ok(), `guest card save: ${await save.text()}`).toBeTruthy()

            // Merge guest → permanent account.
            const merge = await request.post('/api/account/merge', {
                headers: { Authorization: `Bearer ${destToken}` },
                data: { anonAccessToken: anonToken },
            })
            const mergeBody = await merge.json() as { merged?: boolean; error?: string }

            // If anon is enabled but migration 009 isn't applied yet, skip rather
            // than hard-fail — the smoke test activates once the function exists.
            test.skip(
                !merge.ok() && /merge_user_data|schema cache|could not find the function/i.test(mergeBody.error ?? ''),
                `merge_user_data() not deployed: ${mergeBody.error ?? ''}`,
            )

            expect(merge.ok(), `merge: ${mergeBody.error ?? ''}`).toBeTruthy()
            expect(mergeBody.merged).toBe(true)

            // The card now belongs to the permanent account (id is preserved on move).
            const after = await request.get('/api/cards', { headers: { Authorization: `Bearer ${destToken}` } })
            const rows = await after.json() as Array<{ id: string }>
            expect(rows.some((r) => r.id === cardId)).toBeTruthy()
        } finally {
            // Remove the moved card from the permanent account.
            if (cardId) {
                const dest = isolatedClient()
                await dest.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })
                await dest.from('Cards').delete().eq('id', cardId)
            }
            // If the merge didn't run, the guest (and its card) still exist — best-effort drop.
            try { await anonClient.from('Cards').delete().eq('user_id', anonId) } catch { /* ignore */ }
        }
    })
})
