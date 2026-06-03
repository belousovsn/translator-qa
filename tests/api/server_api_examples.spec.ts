import { test, expect, type APIRequestContext } from '@playwright/test'
import type { Card, Translation } from '../../src/types.js'
import { getSupabase } from '../supabase-client.js'
import { TEST_EMAIL, TEST_PASSWORD, ADMIN_API_KEY } from '../../src/config.js'

const CANDIDATE_WORDS = ['dog', 'cat', 'bird', 'water', 'sun']

type CardRow = {
    id: string
    source_word?: string
}

async function signInTestUser() {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    })
    expect(error).toBeNull()

    const accessToken = data.session?.access_token
    expect(accessToken).toBeTruthy()

    const user = data.user
    expect(user?.id).toBeTruthy()

    return {
        accessToken: accessToken ?? '',
        userId: user?.id ?? '',
    }
}

async function fetchTranslation(
    request: APIRequestContext,
    word: string,
    targetLang: 'hy' | 'gr',
): Promise<Translation | null> {
    const response = await request.post('/api/translate', {
        data: {
            word,
            selectedSourceLang: 'en',
            selectedTargetLang: targetLang,
        },
    })

    if (!response.ok()) {
        return null
    }

    return await response.json() as Translation
}

async function pickAdminTestCard(
    request: APIRequestContext,
    accessToken: string,
): Promise<{ card: Card; greekTranslation: Translation }> {
    const cardsResponse = await request.get('/api/cards', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    })
    expect(cardsResponse.ok()).toBeTruthy()

    const existingCards = await cardsResponse.json() as CardRow[]
    const existingWords = new Set(
        existingCards
            .map((row) => row.source_word?.trim().toLowerCase())
            .filter((value): value is string => Boolean(value)),
    )

    for (const word of CANDIDATE_WORDS) {
        if (existingWords.has(word)) continue

        const armenianTranslation = await fetchTranslation(request, word, 'hy')
        const greekTranslation = await fetchTranslation(request, word, 'gr')
        if (!armenianTranslation || !greekTranslation) continue

        return {
            card: {
                id: crypto.randomUUID(),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                ...(armenianTranslation.wordId !== undefined
                    ? { wordId: armenianTranslation.wordId }
                    : {}),
                languagePair: ['en', 'hy'],
                translation: armenianTranslation,
                imageUrlSmall: 'https://example.com/test-small.png',
                imageUrlLarge: 'https://example.com/test-large.png',
                ttsFile: armenianTranslation.ttsFile ?? '',
            },
            greekTranslation,
        }
    }

    throw new Error(`Could not find an unused candidate word from: ${CANDIDATE_WORDS.join(', ')}`)
}

test.describe('Server API examples', () => {
    test('POST /api/translate returns 400 with API error shape for invalid payload', async ({ request }) => {
        const response = await request.post('/api/translate', {
            data: {
                word: '   ',
                selectedSourceLang: 'en',
                selectedTargetLang: 'hy',
            },
        })
        const body = await response.json() as { error?: string }

        expect(response.status()).toBe(400)
        expect(body).toEqual({
            error: 'Word for translation is not present',
        })
    })

    test('POST /api/translate rejects same-language pairs before translation lookup', async ({ request }) => {
        const response = await request.post('/api/translate', {
            data: {
                word: 'cat',
                selectedSourceLang: 'en',
                selectedTargetLang: 'en',
            },
        })
        const body = await response.json() as { error?: string }

        expect(response.status()).toBe(400)
        expect(body).toEqual({
            error: 'Unsupported language pair',
        })
    })

    test('GET /api/settings returns public config and games list', async ({ request }) => {
        const response = await request.get('/api/settings')
        const body = await response.json() as {
            SUPABASE_URL?: string
            SUPABASE_KEY?: string
            UNSPLASH_ACCESS_KEY?: string
            games?: Array<{
                name?: string
                url?: string
                title?: string
                description?: string
                icon?: string
                minCards?: number
            }>
        }

        expect(response.status()).toBe(200)
        expect(Array.isArray(body.games)).toBeTruthy()

        for (const game of body.games ?? []) {
            expect(typeof game.name).toBe('string')
            expect(typeof game.url).toBe('string')
            expect(typeof game.title).toBe('string')
            expect(typeof game.description).toBe('string')
            expect(typeof game.icon).toBe('string')
            if (game.minCards !== undefined) {
                expect(typeof game.minCards).toBe('number')
            }
        }
    })

    test('GET /api/admin/cards can include requested translations on demand', async ({ request }) => {
        const adminApiKey = ADMIN_API_KEY
        test.skip(!adminApiKey, 'ADMIN_API_KEY is required for admin API tests')

        const { accessToken, userId } = await signInTestUser()
        const { card, greekTranslation } = await pickAdminTestCard(request, accessToken)

        const saveResponse = await request.post('/api/admin/cards/save', {
            headers: {
                'x-api-key': adminApiKey ?? '',
            },
            data: {
                card,
                userId,
            },
        })
        expect(saveResponse.ok()).toBeTruthy()

        try {
            const response = await request.get('/api/admin/cards', {
                headers: {
                    'x-api-key': adminApiKey ?? '',
                },
                params: {
                    userId,
                    includeTranslations: 'true',
                    translationLanguages: 'hy,gr',
                },
            })

            const body = await response.json() as Array<{
                id: string
                source_word: string
                target_word: string
                translations?: {
                    hy?: {
                        sourceLang: string
                        targetLang: string
                        sourceWord: string
                        targetWord: string
                    } | null
                    gr?: {
                        sourceLang: string
                        targetLang: string
                        sourceWord: string
                        targetWord: string
                    } | null
                }
            }>

            expect(response.status()).toBe(200)

            const savedCard = body.find((row) => row.id === card.id)
            expect(savedCard).toBeTruthy()
            expect(savedCard).toEqual(expect.objectContaining({
                source_word: card.translation.englishWord.value,
                target_word: card.translation.foreignWord.value,
            }))
            expect(savedCard?.translations?.hy).toEqual(expect.objectContaining({
                sourceLang: 'en',
                targetLang: 'hy',
                sourceWord: card.translation.englishWord.value,
                targetWord: card.translation.foreignWord.value,
            }))
            expect(savedCard?.translations?.gr).toEqual(expect.objectContaining({
                sourceLang: 'en',
                targetLang: 'gr',
                sourceWord: greekTranslation.englishWord.value,
                targetWord: greekTranslation.foreignWord.value,
            }))
        } finally {
            const supabase = await getSupabase()
            await supabase
                .from('Cards')
                .delete()
                .eq('id', card.id)

            await supabase.auth.signOut()
        }
    })

    test('GET /api/admin/cards requires translationLanguages when includeTranslations=true', async ({ request }) => {
        const adminApiKey = ADMIN_API_KEY
        test.skip(!adminApiKey, 'ADMIN_API_KEY is required for admin API tests')

        const { userId } = await signInTestUser()

        try {
            const response = await request.get('/api/admin/cards', {
                headers: {
                    'x-api-key': adminApiKey ?? '',
                },
                params: {
                    userId,
                    includeTranslations: 'true',
                },
            })
            const body = await response.json() as { error?: string }

            expect(response.status()).toBe(400)
            expect(body).toEqual({
                error: 'translationLanguages query param is required when includeTranslations is true',
            })
        } finally {
            const supabase = await getSupabase()
            await supabase.auth.signOut()
        }
    })
})
