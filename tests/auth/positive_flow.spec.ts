import {test, expect} from "@playwright/test"
import { TranslatorPage } from "../../page_objects/translator-page.js"
import { DictionaryPage } from "../../page_objects/dictionary-page.js"
import { catTranslationMockHy } from "../mocks/translationMocks.js"
import {catUnsplashMock} from "../mocks/imageMocks.js"




test('add a new card', async ({page}) => {

    await page.route('**/api/translate', route => {
        route.fulfill({
            status: 200,
            body: JSON.stringify(catTranslationMockHy)
        })
    })

    await page.route('**/api/images**', route => {
        route.fulfill({
            status: 200,
            body: JSON.stringify(catUnsplashMock)
        })
    })


    const translatorPage = new TranslatorPage(page)

    await translatorPage.goto()
    await translatorPage.fillInput('կատու')
    await translatorPage.clickSubmitInput()

    await expect(translatorPage.saveCardButton).toBeVisible()
    await translatorPage.openSaveModal()

    await expect(translatorPage.imagesList.first()).toBeVisible()

    await expect(translatorPage.cardFrontImage).toBeVisible()
    await expect(translatorPage.cardFrontImage).toHaveAttribute('src', /picsum\.photos/)

    expect(await translatorPage.cardFrontText.textContent()).toEqual('cat')
    expect(await translatorPage.cardBackText.textContent()).toEqual('կատու')

    await translatorPage.saveModalConfirmButton.click()
    await expect.soft(translatorPage.scribeOverlay).toContainText('Card saved to your collection', {timeout: 10000})

    const dictPage = new DictionaryPage(page)

    await dictPage.navDictLink.click()
    await expect(dictPage.title).toBeVisible()

    await expect(dictPage.cardList.last()).toBeVisible({timeout: 10000})

    await expect(dictPage.cardFrontImage(dictPage.cardList.last())).toHaveAttribute('src', /picsum\.photos/)
    await expect(dictPage.cardFrontText(dictPage.cardList.last())).toHaveText('cat')
})
