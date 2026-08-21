import { expect, test } from '@playwright/test'

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const IMPORTED_AUDIO_URL = 'https://media.test/imported-audio.mp3?token=private'
const GENERATED_AUDIO_URL = 'https://media.test/generated-audio.mp3?token=private'

test('plays imported and generated audio through the card-first resolver', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, '__playedAudioSources', {
            configurable: true,
            value: [] as string[],
        })
        HTMLMediaElement.prototype.load = () => undefined
        HTMLMediaElement.prototype.play = function () {
            ;(window as typeof window & { __playedAudioSources: string[] }).__playedAudioSources.push(this.src)
            return Promise.resolve()
        }
    })

    await page.route('**/api/cards', route => route.fulfill({
        json: [
            {
                id: 'imported-card',
                created_at: Date.now(),
                updated_at: Date.now(),
                source_lang: 'en',
                target_lang: 'el',
                source_word: 'week',
                target_word: 'εβδομάδα',
                transliteration: 'evdomada',
                img_url_small: IMAGE_DATA_URL,
                img_url_large: IMAGE_DATA_URL,
                audio_url: IMPORTED_AUDIO_URL,
                ttsfile: '',
                score: 0,
                word_id: null,
            },
            {
                id: 'catalog-card',
                created_at: Date.now(),
                updated_at: Date.now(),
                source_lang: 'en',
                target_lang: 'el',
                source_word: 'today',
                target_word: 'σήμερα',
                transliteration: 'simera',
                img_url_small: IMAGE_DATA_URL,
                img_url_large: IMAGE_DATA_URL,
                ttsfile: 'el/today.mp3',
                score: 0,
                word_id: 42,
            },
        ],
    }))

    const resolvedCardIds: string[] = []
    await page.route('**/api/cards/*/audio', route => {
        const cardId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '')
        resolvedCardIds.push(cardId)
        return route.fulfill({ json: cardId === 'imported-card'
            ? { status: 'ready', source: 'imported', url: IMPORTED_AUDIO_URL }
            : { status: 'ready', source: 'tts', url: GENERATED_AUDIO_URL }
        })
    })

    await page.goto('index.html', { waitUntil: 'networkidle' })
    await page.locator('nav.nav-panel a[data-page="dictionary"]').click()
    await expect(page.locator('#dictionaryGrid > .dict-card-wrap')).toHaveCount(2)

    await page.locator('.dict-card-visual[data-card-id="imported-card"]').click()
    await page.locator('[data-dict-tts][data-card-id="imported-card"]').click()
    await expect.poll(() => page.evaluate(() =>
        (window as typeof window & { __playedAudioSources: string[] }).__playedAudioSources[0],
    )).toBe(IMPORTED_AUDIO_URL)

    await page.locator('.dict-card-visual[data-card-id="catalog-card"]').click()
    await page.locator('[data-dict-tts][data-card-id="catalog-card"]').click()
    await expect.poll(() => page.evaluate(() =>
        (window as typeof window & { __playedAudioSources: string[] }).__playedAudioSources[1],
    )).toBe(GENERATED_AUDIO_URL)
    expect(resolvedCardIds).toEqual(['imported-card', 'catalog-card'])
})
