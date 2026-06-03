import {test, expect, BrowserContext, Page} from "@playwright/test"
import { TranslatorPage } from "../../page_objects/translator-page.js"


test.describe('Page elements on initial load', async() => {

    test.describe.configure({mode: "serial"})

    let context: BrowserContext
    let page: Page
    let translatorPage: TranslatorPage

    test.beforeAll(async ({ browser }) => {
        context = await browser.newContext()
        page = await context.newPage()
        // Block seed-word auto-translate so initial-load assertions stay deterministic
        await page.route('**/api/translate', route =>
            route.fulfill({
                status: 400,
                body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }),
            })
        )
        await page.route('**/api/images**', route =>
            route.fulfill({ status: 200, body: '[]' })
        )
        translatorPage = new TranslatorPage(page)
        await translatorPage.goto()
    })

    test.afterAll(async () => {
        await context.close()
    })

    test.beforeEach(async () => {
        await translatorPage.inputField.clear()
        if (await translatorPage.keyboard.isVisible()) {
            await translatorPage.keyboardToggle.click()
        }
    })

    test('input field', async() => {
        await translatorPage.inputField.pressSequentially('testword2', {delay: 200})
        await expect(translatorPage.inputField).toHaveValue('testword2')
    })
    test('keyboard is shown on toggle', async({}) => {
        await expect(translatorPage.keyboard).not.toBeVisible()
        await translatorPage.keyboardToggle.click()
        await expect(translatorPage.keyboard).toBeVisible()
        await translatorPage.keyboardToggle.click()
        await expect(translatorPage.keyboard).not.toBeVisible()
    })
    test('keyboard keys values are put into input', async() => {
        let keys = translatorPage.keyboard.locator('.key')
        keys = keys
            .filter({hasNotText: "Shift"})
            .filter({hasNotText: 'Space'})
        const keyList = await keys.all()

        await translatorPage.keyboardToggle.click()
        
        let typedWord = await translatorPage.typeRandomButtons(keyList, 5)
       
        await expect(translatorPage.inputField).toHaveValue(typedWord)
        await translatorPage.inputField.clear()
        await translatorPage.keyboardToggle.click()
    })
    test('sections visibility on initial load', async () => {

        await expect(translatorPage.inputField).toBeVisible()
        await expect(translatorPage.searchButton).toBeVisible()
        await expect(translatorPage.translationPanel).toBeVisible()

        await expect(translatorPage.suggestedImagesSection).not.toBeVisible()
        await expect(translatorPage.saveCardButton).not.toBeVisible()
        await expect(translatorPage.saveCardModal).toHaveClass(/hidden/)
        await expect(translatorPage.similarWordsSection).not.toBeVisible()
        }
    )
})