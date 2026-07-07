/// <reference types="node" />

import { test, expect, BrowserContext, Page } from '@playwright/test'
import { TranslatorPage } from '../../page_objects/translator-page.js'
import { dogTranslationMockHy, dogTranslationMockHyWithTts, dogTranslationMockEl } from '../mocks/translationMocks.js'
import { catUnsplashMock } from '../mocks/imageMocks.js'

const WORD_NOT_FOUND_WITH_SUGGESTIONS = JSON.stringify({
    code: 'WORD_NOT_FOUND',
    error: 'Word is not found in language corpus',
    suggestions: ['dog', 'dig'],
})
const WORD_NOT_FOUND_WITHOUT_SUGGESTIONS = JSON.stringify({
    code: 'WORD_NOT_FOUND',
    error: 'Word is not found in language corpus',
    suggestions: [],
})

const DOG_TRANSLATION_WITH_ENRICHMENT = {
    ...dogTranslationMockHy,
    enrichment: {
        synonyms: ['hound', 'canine'],
        examples: [
            {
                source: 'The dog runs in the yard',
                translation: 'Շունը վազում է բակում',
                targetToken: 'dog',
            },
        ],
    },
}
/** A tiny valid audio blob (silence WAV header) used to satisfy TTS download */
const SILENT_WAV = Buffer.from('52494646...', 'hex')

test.describe('Translate English word', () => {
    test.describe.configure({ mode: 'serial' })

    let context: BrowserContext
    let page: Page
    let translatorPage: TranslatorPage

    test.beforeAll(async ({ browser }) => {
        context = await browser.newContext()
        page = await context.newPage()
        translatorPage = new TranslatorPage(page)
    })

    test.afterAll(async () => {
        await context.close()
    })

    // Routes are cleared between tests; each test sets up its own mocks
    // and calls goto() AFTER mocks are ready (same pattern as positive_flow.spec.ts)
    test.beforeEach(async () => {
        await page.unrouteAll()
    })

    // ════════════════════════════════════════════════════════════════════════
    // Language: Armenian
    // Default app state has sourceLang=hy / targetLang=en.
    // Typing an English word triggers the language-swap logic so that after
    // translation the left dropdown reads "English" and the right reads
    // "Armenian".
    // ════════════════════════════════════════════════════════════════════════
    test.describe('English → Armenian', () => {

        // ── core result ──────────────────────────────────────────────────────
        test('shows Armenian translation, correct dropdowns, images, card, and Save button', async () => {
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHy) })
            )
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dog')

            // Translation shown
            await expect(translatorPage.translatedWord).toHaveText('շուն')

            // Transliteration shown under the translated word
            await expect(translatorPage.translitDisplay).toHaveText('shun')
            // No translit under the English input
            await expect(translatorPage.inputTranslitDisplay).toHaveText('')

            // Language dropdowns updated
            await expect(translatorPage.sourceLangLabel).toHaveText('English')
            await expect(translatorPage.targetLangLabel).toHaveText('Armenian')

            // Save button visible and enabled (appears once translation + images ready)
            // Save modal contents (images, card preview) require sign-in: covered in auth tests.
            await expect(translatorPage.saveCardButton).toBeVisible()
            await expect(translatorPage.saveCardButton).toBeEnabled()
        })

        // ── enrichment from translate payload ───────────────────────────────
        test('renders enrichment panel when translate response includes enrichment', async () => {
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 200, body: JSON.stringify(DOG_TRANSLATION_WITH_ENRICHMENT) })
            )
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dog')

            await expect(translatorPage.enrichmentPanel).toBeVisible()
            await expect(translatorPage.synonymsList.locator('.chip')).toHaveText(['hound', 'canine'])
            await expect(translatorPage.examplesList.locator('.example-item')).toHaveCount(1)
            await expect(translatorPage.examplesList.locator('mark.example-highlight')).toContainText('dog')
        })

        // ── suggestions: present ─────────────────────────────────────────────
        test('shows suggestions panel when translate API returns WORD_NOT_FOUND with suggestions', async () => {
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 400, body: WORD_NOT_FOUND_WITH_SUGGESTIONS })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dgo')

            await expect(translatorPage.similarWordsSection).toBeVisible()
            await expect(translatorPage.suggestionsHint).toHaveText('Did you mean:')
            await expect(translatorPage.similarWordsSection.locator('.chip')).toHaveText(['dog', 'dig'])
        })

        // ── suggestions: absent ──────────────────────────────────────────────
        test('hides suggestions panel when translate API returns WORD_NOT_FOUND without suggestions', async () => {
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 400, body: WORD_NOT_FOUND_WITHOUT_SUGGESTIONS })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('zzzzdog')

            await expect(translatorPage.similarWordsSection).not.toBeVisible()
            await expect(translatorPage.similarWordsSection.locator('.chip')).toHaveCount(0)
            await expect(translatorPage.translatedWord).toHaveText('')
        })

        // ── suggestions click path ───────────────────────────────────────────
        test('clicking suggestion chip retries translate and renders normal success state', async () => {
            await page.route('**/api/translate', async route => {
                const body = route.request().postDataJSON() as { word?: string }
                if (body.word === 'dgo') {
                    await route.fulfill({ status: 400, body: WORD_NOT_FOUND_WITH_SUGGESTIONS })
                    return
                }
                await route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHy) })
            })
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dgo')

            await expect(translatorPage.similarWordsSection.locator('.chip').first()).toBeVisible()
            await translatorPage.similarWordsSection.locator('.chip', { hasText: 'dog' }).click()

            await expect(translatorPage.translatedWord).toHaveText('շուն')
            await expect(translatorPage.similarWordsSection).not.toBeVisible()
            await expect(translatorPage.saveCardButton).toBeVisible()
            await expect(translatorPage.inputField).toHaveValue('dog')

        })

        // ── TTS: available ───────────────────────────────────────────────────
        test('enables target TTS button when the word has a sound file', async () => {
            // Server returns Translation with ttsFile populated
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHyWithTts) })
            )
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            // Supabase storage download for the TTS file
            await page.route('**/storage/v1/**', route =>
                route.fulfill({
                    status: 200,
                    contentType: 'audio/wav',
                    body: SILENT_WAV,
                })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dog')

            // Source TTS stays disabled (user typed English, foreign word is on the target side)
            await expect(translatorPage.sourceTtsBtn).toBeDisabled()
            // Target TTS is enabled
            await expect(translatorPage.targetTtsBtn).toBeEnabled()
        })

        // ── TTS: unavailable ─────────────────────────────────────────────────
        test('keeps all TTS buttons disabled when the word has no sound file', async () => {
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHy) })
            )
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dog')

            await expect(translatorPage.sourceTtsBtn).toBeDisabled()
            await expect(translatorPage.targetTtsBtn).toBeDisabled()
        })
    })

    // ════════════════════════════════════════════════════════════════════════
    // Language: Greek (code `el` — the app migrated gr → el)
    // Language state is pre-set via localStorage so the page boots with
    // sourceLang=en / targetLang=el (bypassing the UI language selector).
    // ════════════════════════════════════════════════════════════════════════
    test.describe('English → Greek', () => {

        // ── core result ──────────────────────────────────────────────────────
        test('shows Greek translation, correct dropdowns, images, card, and Save button', async () => {
            await page.addInitScript(() => {
                // Study language must be Greek: the pair is locked to study ↔ English,
                // so without this the app coerces the Greek target back to the default
                // study language (Armenian). Also marks the user as returning so the
                // first-run welcome picker stays closed.
                localStorage.setItem('mainLang', 'el')
                localStorage.setItem('sourceLang', 'en')
                localStorage.setItem('targetLang', 'el')
            })
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockEl) })
            )
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dog')

            await expect(translatorPage.translatedWord).toHaveText('σκύλος')

            // Greek supports transliteration since the gr → el migration
            await expect(translatorPage.translitDisplay).toHaveText('skýlos')

            await expect(translatorPage.sourceLangLabel).toHaveText('English')
            await expect(translatorPage.targetLangLabel).toHaveText('Greek')

            // Save modal contents (images, card preview) require sign-in: covered in auth tests.
            await expect(translatorPage.saveCardButton).toBeVisible()
            await expect(translatorPage.saveCardButton).toBeEnabled()
        })

        // ── suggestions: present ─────────────────────────────────────────────
        test('shows suggestions panel for Greek flow when translate API returns WORD_NOT_FOUND', async () => {
            await page.addInitScript(() => {
                // Study language must be Greek: the pair is locked to study ↔ English,
                // so without this the app coerces the Greek target back to the default
                // study language (Armenian). Also marks the user as returning so the
                // first-run welcome picker stays closed.
                localStorage.setItem('mainLang', 'el')
                localStorage.setItem('sourceLang', 'en')
                localStorage.setItem('targetLang', 'el')
            })
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 400, body: WORD_NOT_FOUND_WITH_SUGGESTIONS })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dgo')

            await expect(translatorPage.similarWordsSection).toBeVisible()
            await expect(translatorPage.suggestionsHint).toHaveText('Did you mean:')
            await expect(translatorPage.similarWordsSection.locator('.chip')).toHaveText(['dog', 'dig'])
        })

        // ── suggestions: absent ──────────────────────────────────────────────
        test('hides suggestions panel for Greek flow when translate API returns no suggestions', async () => {
            await page.addInitScript(() => {
                // Study language must be Greek: the pair is locked to study ↔ English,
                // so without this the app coerces the Greek target back to the default
                // study language (Armenian). Also marks the user as returning so the
                // first-run welcome picker stays closed.
                localStorage.setItem('mainLang', 'el')
                localStorage.setItem('sourceLang', 'en')
                localStorage.setItem('targetLang', 'el')
            })
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 400, body: WORD_NOT_FOUND_WITHOUT_SUGGESTIONS })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('zzzzdog')

            await expect(translatorPage.similarWordsSection).not.toBeVisible()
            await expect(translatorPage.similarWordsSection.locator('.chip')).toHaveCount(0)

        })

        // ── TTS: unavailable (Greek supports TTS, but this word has no file) ──
        test('keeps all TTS buttons disabled when the Greek word has no sound file', async () => {
            await page.addInitScript(() => {
                // Study language must be Greek: the pair is locked to study ↔ English,
                // so without this the app coerces the Greek target back to the default
                // study language (Armenian). Also marks the user as returning so the
                // first-run welcome picker stays closed.
                localStorage.setItem('mainLang', 'el')
                localStorage.setItem('sourceLang', 'en')
                localStorage.setItem('targetLang', 'el')
            })
            await page.route('**/api/translate', route =>
                route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockEl) })
            )
            await page.route('**/api/images**', route =>
                route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) })
            )
            await translatorPage.goto()
            await translatorPage.translateInput('dog')

            await expect(translatorPage.sourceTtsBtn).toBeDisabled()
            await expect(translatorPage.targetTtsBtn).toBeDisabled()
        })
    })
})
