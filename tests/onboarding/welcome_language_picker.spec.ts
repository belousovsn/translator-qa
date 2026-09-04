import { test, expect, type Page } from '@playwright/test'
import { suppressTabIntros } from '../../page_objects/first-run.js'

// First-run welcome (`#welcomeOverlay`). A brand-new guest — no `mainLang` in
// localStorage and no study language on their profile — first sees the product
// idea, then picks a language. This is deliberately NOT using the
// page-object goto() helpers: those seed `mainLang` to skip the picker, whereas
// here the picker is the subject under test. Guarding it directly stops the
// overlay (a modal that intercepts pointer events) from silently regressing and
// blocking the rest of the suite again.

async function blockNetwork(page: Page): Promise<void> {
    await page.route('**/api/settings', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            SUPABASE_URL: 'https://welcome-test.supabase.co',
            SUPABASE_KEY: 'welcome-test-anon-key',
            games: [],
            anonAllowedGames: null,
        }),
    }))
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
    )
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
}

const overlay = '#welcomeOverlay'
const intro = '#welcomeIntroStep'
const introTitle = '#welcomeIntroTitle'
const introContinue = '#welcomeIntroContinue'
const languageStep = '#welcomeLanguageStep'
const tiles = '#welcomeLangGrid button[data-lang]'
const start = '#welcomeStart'

async function continueToLanguages(page: Page): Promise<void> {
    await page.locator(introContinue).click()
    await expect(page.locator(intro)).toBeHidden()
    await expect(page.locator(languageStep)).toBeVisible()
}

// These specs drive the app directly rather than through a page object, so they
// seed the "tab notes already read" state themselves: the note is a modal that
// swallows the nav and game-card clicks below.
test.beforeEach(async ({ page }) => {
    await suppressTabIntros(page)
})

test.describe('First-run welcome language picker', () => {
    test('a brand-new guest sees the vocabulary-through-games idea first', { tag: '@smoke' }, async ({ page }) => {
        await blockNetwork(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })

        await expect(page.locator(overlay)).toBeVisible()
        await expect(page.locator(introTitle)).toHaveText('Build your vocabulary through games')
        await expect(page.locator(intro)).toContainText('play them into memory')
        await expect(page.locator(languageStep)).toBeHidden()
        await expect(page.locator(introContinue)).toHaveText('Let’s go')
    })

    test('continuing reveals the language picker', async ({ page }) => {
        await blockNetwork(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })

        await continueToLanguages(page)
        await expect(page.locator('#welcomeLanguageTitle')).toHaveText('What language are you learning?')
        await expect(page.locator(languageStep)).toContainText('You can change this anytime.')
        // At least one study language is offered to choose from.
        await expect(page.locator(tiles).first()).toBeVisible()
        const count = await page.locator(tiles).count()
        expect(count).toBeGreaterThan(0)
    })

    test('picking a language dismisses the overlay and pins the From label', async ({ page }) => {
        await blockNetwork(page)
        // Keep this test focused on committing the language choice. The path's
        // conditional Phrase Builder handoff has its own coverage.
        await page.addInitScript(() => window.localStorage.setItem(
            'translator.onboarding.path.v1',
            JSON.stringify({ status: 'completed', stepIndex: 4, startedAt: Date.now() }),
        ))
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await continueToLanguages(page)

        const chosen = page.locator(tiles).first()
        const chosenLang = await chosen.getAttribute('data-lang')
        const chosenName = (await chosen.locator('.profile-language-tile-name').textContent())?.trim() ?? ''
        expect(chosenLang).toBeTruthy()
        expect(chosenName.length).toBeGreaterThan(0)

        // Tapping a tile only selects it — the choice is committed by Continue,
        // which the tile click enables.
        await chosen.click()
        await expect(chosen).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator(start)).toBeEnabled()
        await page.locator(start).click()

        // Overlay closes and the choice is persisted as the study language.
        await expect(page.locator(overlay)).toBeHidden()
        await expect
            .poll(() => page.evaluate(() => window.localStorage.getItem('mainLang')))
            .toBe(chosenLang)

        // The locked pair is English ↔ study, in the learning direction: English
        // stays on the From side and the chosen language becomes the To target.
        await expect(page.locator('#sourceLangLabel')).toHaveText('English')
        await expect(page.locator('#targetLangLabel')).toHaveText(chosenName)
    })

    test('a returning guest with a saved study language never sees the picker', async ({ page }) => {
        await blockNetwork(page)
        await page.addInitScript(() => window.localStorage.setItem('mainLang', 'hy'))
        await page.goto('index.html', { waitUntil: 'networkidle' })

        await expect(page.locator(overlay)).toBeHidden()
        // Armenian is pinned as the study (To) language; English stays the source.
        await expect(page.locator('#targetLangLabel')).toHaveText('Armenian')
    })
})
