import { expect, type APIRequestContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import type { Card, Language, Translation } from '../src/types.js'
import { requireTestCredentials } from '../src/config.js'

// Node < 22 has no global WebSocket (needed by @supabase/realtime-js).
const realtimeTransport = WebSocket as unknown as typeof globalThis.WebSocket

// Common words every study-language catalog has. More than any spec asks for,
// so a word missing from one corpus does not fail the seed.
const SEED_WORDS = ['river', 'bridge', 'window', 'apple', 'bread', 'water', 'house', 'dog', 'book', 'tree']

/**
 * Give the test account `count` real en→`targetLang` cards through the app's own
 * API, so they carry a word_id and count for games. Returns a cleanup that
 * deletes exactly these cards.
 */
export async function seedCards(
    request: APIRequestContext,
    targetLang: Language,
    count: number,
): Promise<() => Promise<void>> {
    const { email, password } = requireTestCredentials()
    const settings = await (await request.get('/api/settings')).json() as { SUPABASE_URL?: string; SUPABASE_KEY?: string }
    expect(settings.SUPABASE_URL, 'SUPABASE_URL from /api/settings').toBeTruthy()
    expect(settings.SUPABASE_KEY, 'SUPABASE_KEY from /api/settings').toBeTruthy()

    // Never persists its session, so it cannot clobber the browser's sign-in.
    const client = createClient(settings.SUPABASE_URL!, settings.SUPABASE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { transport: realtimeTransport },
    })
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    expect(error).toBeNull()
    const token = data.session?.access_token ?? ''
    expect(token).toBeTruthy()

    const createdIds: string[] = []
    const cleanup = async (): Promise<void> => {
        if (createdIds.length > 0) await client.from('Cards').delete().in('id', createdIds)
        // Local scope: a global signOut would revoke the browser's session too.
        await client.auth.signOut({ scope: 'local' })
    }

    try {
        for (const word of SEED_WORDS) {
            if (createdIds.length >= count) break
            const translated = await request.post('/api/translate', {
                data: { word, selectedSourceLang: 'en', selectedTargetLang: targetLang },
            })
            if (!translated.ok()) continue
            const translation = await translated.json() as Translation
            if (translation.wordId === undefined) continue

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
            createdIds.push(card.id)
        }
        expect(createdIds, `${count} en→${targetLang} cards for the test account`).toHaveLength(count)
    } catch (err) {
        await cleanup()
        throw err
    }
    return cleanup
}
