import { test, expect, type Page } from '@playwright/test'
import { TranslatorPage } from '../../page_objects/translator-page.js'

// Translation direction control (the standalone swap button). Pure UI state —
// the translate/images endpoints are blocked so nothing here depends on a live
// translation. Default guest state is the Armenian study language and the app
// boots its demo word in the learning direction, so the bar reads From
// "English" / To "Armenian".
//
// Note: the inline From/To dropdown selectors (`#sourceLangBtn` / `#targetLangBtn`)
// are hidden in the current design (`.lang-toggle-bar { display: none }`), so the
// swap button is the only on-page direction control to exercise. Study-language
// selection itself is covered by the welcome picker and profile flows.
async function blockNetwork(page: Page): Promise<void> {
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
    )
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
}

test.describe('Translation direction (swap)', () => {
    let translator: TranslatorPage

    test.beforeEach(async ({ page }) => {
        translator = new TranslatorPage(page)
        await blockNetwork(page)
        await translator.goto()
        await expect(translator.sourceLangLabel).toHaveText('English')
        await expect(translator.targetLangLabel).toHaveText('Armenian')
    })

    test('swap button reverses the From/To direction and is reversible', { tag: '@smoke' }, async () => {
        await expect(translator.langSwapBtn).toBeVisible()

        await translator.langSwapBtn.click()
        await expect(translator.sourceLangLabel).toHaveText('Armenian')
        await expect(translator.targetLangLabel).toHaveText('English')

        // Swapping again restores the original direction.
        await translator.langSwapBtn.click()
        await expect(translator.sourceLangLabel).toHaveText('English')
        await expect(translator.targetLangLabel).toHaveText('Armenian')
    })
})
