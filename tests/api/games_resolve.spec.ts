import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import type { Card, Language, Translation } from '../../src/types.js'
import { TEST_EMAIL, TEST_PASSWORD } from '../../src/config.js'

// Contract checks for POST /api/games/resolve — the endpoint that decides which
// of the player's cards a game may use. The heart of it is the focused-learning
// round-trip: with a mixed-language collection (cards saved for different study
// languages), a focused `cardIds` selection must resolve per language — only
// cards of the requested pair qualify, and the focus echo reports how many of
// the requested cards matched.

// Node < 22 has no global WebSocket (needed by @supabase/realtime-js).
const realtimeTransport = WebSocket as unknown as typeof globalThis.WebSocket
// Word for the round-trip cards; fallbacks in case a corpus is missing one.
const FOCUS_WORDS = ['river', 'bridge', 'window']

let supabaseUrl = ''
let supabaseKey = ''
let resolvableGame = ''

async function loadEnv(request: APIRequestContext): Promise<void> {
    if (supabaseUrl && supabaseKey && resolvableGame) return
    const res = await request.get('/api/settings')
    const body = await res.json() as {
        SUPABASE_URL?: string
        SUPABASE_KEY?: string
        games?: Array<{ name: string; multiplayer?: boolean; requires?: { topicPack?: string; deckSlug?: string } }>
    }
    supabaseUrl = body.SUPABASE_URL ?? ''
    supabaseKey = body.SUPABASE_KEY ?? ''
    // Any game without pack/deck-scoped requirements resolves from the plain
    // collection, which is what the focus round-trip needs.
    resolvableGame = body.games?.find((g) => !g.requires?.topicPack && !g.requires?.deckSlug)?.name ?? ''
    expect(supabaseUrl, 'SUPABASE_URL from /api/settings').toBeTruthy()
    expect(supabaseKey, 'SUPABASE_KEY from /api/settings').toBeTruthy()
    expect(resolvableGame, 'a resolvable game in /api/settings games').toBeTruthy()
}

// A throwaway client that never persists its session, so parallel specs sharing
// a worker can't clobber each other's auth state.
function isolatedClient(): SupabaseClient {
    return createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { transport: realtimeTransport },
    })
}

async function signIn(client: SupabaseClient): Promise<string> {
    const { data, error } = await client.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    })
    expect(error).toBeNull()
    const token = data.session?.access_token ?? ''
    expect(token).toBeTruthy()
    return token
}

async function fetchTranslation(
    request: APIRequestContext,
    word: string,
    targetLang: Language,
): Promise<Translation | null> {
    const response = await request.post('/api/translate', {
        data: { word, selectedSourceLang: 'en', selectedTargetLang: targetLang },
    })
    return response.ok() ? await response.json() as Translation : null
}

/** Translate `word` into `targetLang` and save it as a card; returns the card id. */
async function saveCard(
    request: APIRequestContext,
    token: string,
    word: string,
    targetLang: Language,
): Promise<string | null> {
    const translation = await fetchTranslation(request, word, targetLang)
    if (!translation || translation.wordId === undefined) return null

    const card: Card = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordId: translation.wordId,
        languagePair: ['en', targetLang],
        translation,
        imageUrlSmall: 'https://example.com/test-small.png',
        imageUrlLarge: 'https://example.com/test-large.png',
        ttsFile: translation.ttsFile ?? '',
    }
    const save = await request.post('/api/cards/save', {
        headers: { Authorization: `Bearer ${token}` },
        data: card,
    })
    expect(save.ok(), `card save (${word} → ${targetLang}): ${await save.text()}`).toBeTruthy()
    return card.id
}

type ResolveResponse = {
    ok: boolean
    qualified: Array<{ cardId: string; wordId: number }>
    shortfall: number
    requires: { minCards: number }
    focus: { mode: 'default' } | { mode: 'cards'; requestedCardCount: number; matchedCardCount: number }
}

async function resolve(
    request: APIRequestContext,
    token: string,
    targetLang: Language,
    cardIds: string[],
): Promise<ResolveResponse> {
    const res = await request.post('/api/games/resolve', {
        headers: { Authorization: `Bearer ${token}` },
        data: {
            gameName: resolvableGame,
            sourceLang: 'en',
            targetLang,
            focus: { mode: 'cards', cardIds },
        },
    })
    expect(res.status(), `resolve ${targetLang}: ${await res.text()}`).toBe(200)
    return await res.json() as ResolveResponse
}

test.describe('POST /api/games/resolve', () => {
    // ---- Guards & validation (no cards involved) ----

    test('rejects an unauthenticated request', async ({ request }) => {
        const res = await request.post('/api/games/resolve', {
            data: { gameName: 'anything', sourceLang: 'en', targetLang: 'hy' },
        })
        expect(res.status()).toBe(401)
    })

    test('requires gameName and languages', async ({ request }) => {
        await loadEnv(request)
        const client = isolatedClient()
        const token = await signIn(client)

        const res = await request.post('/api/games/resolve', {
            headers: { Authorization: `Bearer ${token}` },
            data: { sourceLang: 'en', targetLang: 'hy' },
        })
        expect(res.status()).toBe(400)
        expect((await res.json()).error).toBe('gameName, sourceLang, and targetLang are required')
    })

    test('rejects a malformed focus payload', async ({ request }) => {
        await loadEnv(request)
        const client = isolatedClient()
        const token = await signIn(client)

        const res = await request.post('/api/games/resolve', {
            headers: { Authorization: `Bearer ${token}` },
            data: {
                gameName: resolvableGame,
                sourceLang: 'en',
                targetLang: 'hy',
                focus: { mode: 'cards' }, // cardIds missing
            },
        })
        expect(res.status()).toBe(400)
        expect((await res.json()).error).toBe('focus.cardIds must be an array')
    })

    test('returns 404 for an unknown game', async ({ request }) => {
        await loadEnv(request)
        const client = isolatedClient()
        const token = await signIn(client)

        const res = await request.post('/api/games/resolve', {
            headers: { Authorization: `Bearer ${token}` },
            data: { gameName: 'no-such-game', sourceLang: 'en', targetLang: 'hy' },
        })
        expect(res.status()).toBe(404)
        expect((await res.json()).error).toBe('Game not found')
    })

    // ---- Focused learning with a mixed-language collection (live round-trip) ----

    test('a focused selection resolves per language when the collection mixes languages', async ({ request }) => {
        await loadEnv(request)
        const client = isolatedClient()
        const token = await signIn(client)

        let hyCardId: string | null = null
        let elCardId: string | null = null
        const createdIds: string[] = [] // everything saved, so a partial attempt still gets cleaned up
        try {
            // One word, two study languages → two cards owned by the same user.
            for (const word of FOCUS_WORDS) {
                hyCardId = await saveCard(request, token, word, 'hy')
                if (hyCardId) createdIds.push(hyCardId)
                elCardId = await saveCard(request, token, word, 'el')
                if (elCardId) createdIds.push(elCardId)
                if (hyCardId && elCardId) break
            }
            expect(hyCardId, 'an en→hy card for the focus set').toBeTruthy()
            expect(elCardId, 'an en→el card for the focus set').toBeTruthy()

            const focusIds = [hyCardId!, elCardId!]

            // Armenian game: only the Armenian card of the pair qualifies.
            const hy = await resolve(request, token, 'hy', focusIds)
            expect(hy.focus).toEqual({ mode: 'cards', requestedCardCount: 2, matchedCardCount: 1 })
            expect(hy.qualified.map((c) => c.cardId)).toEqual([hyCardId])

            // Greek game, same selection: the Greek card qualifies instead.
            const el = await resolve(request, token, 'el', focusIds)
            expect(el.focus).toEqual({ mode: 'cards', requestedCardCount: 2, matchedCardCount: 1 })
            expect(el.qualified.map((c) => c.cardId)).toEqual([elCardId])
        } finally {
            if (createdIds.length > 0) {
                await client.from('Cards').delete().in('id', createdIds)
            }
            await client.auth.signOut({ scope: 'local' })
        }
    })
})
