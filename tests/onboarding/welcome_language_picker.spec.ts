import { test, expect, type Page } from '@playwright/test'

// First-run study-language picker (`#welcomeOverlay`). A brand-new guest — no
// `mainLang` in localStorage and no study language on their profile — is asked
// to pick a language before anything else. This is deliberately NOT using the
// page-object goto() helpers: those seed `mainLang` to skip the picker, whereas
// here the picker is the subject under test. Guarding it directly stops the
// overlay (a modal that intercepts pointer events) from silently regressing and
// blocking the rest of the suite again.

async function blockNetwork(page: Page): Promise<void> {
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
    )
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
}

const overlay = '#welcomeOverlay'
const title = '#welcomeTitle'
const tiles = '#welcomeLangGrid button[data-lang]'

test.describe('First-run welcome language picker', () => {
    test('a brand-new guest is shown the language picker', async ({ page }) => {
        await blockNetwork(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })

        await expect(page.locator(overlay)).toBeVisible()
        await expect(page.locator(title)).toBeVisible()
        // At least one study language is offered to choose from.
        await expect(page.locator(tiles).first()).toBeVisible()
        const count = await page.locator(tiles).count()
        expect(count).toBeGreaterThan(0)
    })

    test('picking a language dismisses the overlay and pins the From label', async ({ page }) => {
        await blockNetwork(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })

        const chosen = page.locator(tiles).first()
        const chosenLang = await chosen.getAttribute('data-lang')
        const chosenName = (await chosen.locator('.profile-language-tile-name').textContent())?.trim() ?? ''
        expect(chosenLang).toBeTruthy()
        expect(chosenName.length).toBeGreaterThan(0)

        await chosen.click()

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
