import { test, expect, type APIRequestContext } from '@playwright/test'
import type { CardsTranslateResponse } from '../../src/types.js'
import { getSupabase } from '../supabase-client.js'
import { TEST_EMAIL, TEST_PASSWORD, ADMIN_API_KEY } from '../../src/config.js'

// Contract checks for POST /api/cards/translate — the scoped-card-token batch
// endpoint that backs the games SDK's `ctx.translate` (mp-runtime). The validation
// checks run anywhere; the happy path needs an admin key to mint a card token and
// game-token signing configured server-side, so it auto-skips otherwise.

async function signInTestUser(): Promise<{ accessToken: string; userId: string }> {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    })
    expect(error).toBeNull()
    const accessToken = data.session?.access_token ?? ''
    expect(accessToken).toBeTruthy()
    return { accessToken, userId: data.user?.id ?? '' }
}

// Mint a scoped card token by signing a match ticket (admin, server-to-server) and
// reading the embedded `cardToken` claim. Returns null when signing isn't available.
async function mintCardToken(request: APIRequestContext, userId: string): Promise<string | null> {
    const res = await request.post('/api/games/sign-match', {
        headers: { 'x-api-key': ADMIN_API_KEY },
        data: { gameId: 'qa-smoke', players: [{ userId }] },
    })
    if (res.status() === 503) return null // game-token signing not configured on this env
    expect(res.ok(), `sign-match: ${await res.text()}`).toBeTruthy()
    const body = (await res.json()) as { tickets?: Array<{ matchTicket?: string }> }
    const ticket = body.tickets?.[0]?.matchTicket
    if (!ticket) return null
    const payload = JSON.parse(Buffer.from(ticket.split('.')[1] ?? '', 'base64url').toString()) as {
        cardToken?: string
    }
    return payload.cardToken ?? null
}

test.describe('POST /api/cards/translate', () => {
    test('rejects a request with no bearer token', async ({ request }) => {
        const res = await request.post('/api/cards/translate', {
            data: { words: ['apple'], languages: ['gr'] },
        })
        expect(res.status()).toBe(401)
    })

    test('rejects a non-scoped (bogus) bearer token', async ({ request }) => {
        const res = await request.post('/api/cards/translate', {
            headers: { Authorization: 'Bearer not-a-real-card-token' },
            data: { words: ['apple'], languages: ['gr'] },
        })
        expect(res.status()).toBe(401)
    })

    test('returns the translations map for a scoped card token', async ({ request }) => {
        test.skip(!ADMIN_API_KEY, 'ADMIN_API_KEY is required to mint a scoped card token')
        const { userId } = await signInTestUser()

        try {
            const cardToken = await mintCardToken(request, userId)
            test.skip(!cardToken, 'game-token signing not configured on this environment')

            // Empty inputs short-circuit to an empty map.
            const empty = await request.post('/api/cards/translate', {
                headers: { Authorization: `Bearer ${cardToken}` },
                data: { words: [], languages: [] },
            })
            expect(empty.status()).toBe(200)
            expect(await empty.json()).toEqual({ translations: {} })

            // A real lookup: response is keyed by the exact word; each language maps to
            // a CardTranslation or null (null = no stored/derivable translation).
            const res = await request.post('/api/cards/translate', {
                headers: { Authorization: `Bearer ${cardToken}` },
                data: { words: ['apple'], languages: ['gr'] },
            })
            expect(res.status()).toBe(200)
            const body = (await res.json()) as CardsTranslateResponse
            expect(body.translations).toBeTruthy()
            expect(Object.prototype.hasOwnProperty.call(body.translations, 'apple')).toBeTruthy()

            const gr = body.translations.apple?.gr
            if (gr !== null && gr !== undefined) {
                expect(typeof gr.word).toBe('string')
                expect(gr.word.length).toBeGreaterThan(0)
            }
        } finally {
            const supabase = await getSupabase()
            await supabase.auth.signOut()
        }
    })
})
