import {type Page, type Locator, expect} from '@playwright/test'
import { suppressFirstRunWelcome } from './first-run.js'

export class TranslatorPage {
    readonly page: Page;
    readonly inputField: Locator;
    readonly keyboard: Locator;
    readonly keyboardToggle: Locator;
    readonly similarWordsSection: Locator;
    readonly suggestedImagesSection: Locator;
    readonly searchButton: Locator;
    readonly saveCardButton: Locator;
    readonly saveCardModal: Locator;
    readonly saveModalCloseButton: Locator;
    readonly saveModalCancelButton: Locator;
    readonly saveModalConfirmButton: Locator;
    readonly card: Locator;
    readonly cardFrontImage: Locator;
    readonly cardFrontText: Locator;
    readonly cardBackText: Locator;
    readonly imagesList: Locator;
    readonly translationPanel: Locator;
    readonly translatedWord: Locator;
    readonly sourceLangLabel: Locator;
    readonly targetLangLabel: Locator;
    readonly langSwapBtn: Locator;
    readonly sourceTtsBtn: Locator;
    readonly targetTtsBtn: Locator;
    readonly cardTtsBtn: Locator;
    readonly translitDisplay: Locator;
    readonly inputTranslitDisplay: Locator;
    readonly enrichmentPanel: Locator;
    readonly synonymsList: Locator;
    readonly examplesList: Locator;
    readonly suggestionsHint: Locator;
    readonly scribeOverlay: Locator;
    readonly nextWordButton: Locator;
    readonly pumpDoneMessage: Locator;
    readonly pumpBarPosition: Locator;
    readonly pumpBarTotal: Locator;
    readonly pumpBarProgressText: Locator;
    readonly pumpBarDoneIcon: Locator;
constructor(page: Page) {
    this.page = page
    this.inputField = page.locator('#searchInput')
    this.keyboard = page.locator('#armenianKeyboard')
    this.keyboardToggle = page.locator('#keyboardToggle')
    this.similarWordsSection = page.locator('.panel.suggestions-panel')
    this.suggestedImagesSection = page.locator('.panel.images-panel')
    this.searchButton = page.locator('#searchBtn')
    this.saveCardButton = page.locator('#saveToLearnBtn')
    this.saveCardModal = page.locator('#saveCardModal')
    this.saveModalCloseButton = page.locator('#saveCardModalClose')
    this.saveModalCancelButton = page.locator('#saveCardModalCancel')
    this.saveModalConfirmButton = page.locator('#saveCardModalSave')
    this.card = page.locator('#saveModalCard')
    this.cardFrontImage = page.locator('#saveModalCardImage img')
    this.cardFrontText = page.locator('#saveModalCardEnglish')
    this.cardBackText = page.locator('#saveModalCardForeign')
    this.imagesList = this.page.locator('#saveModalImages li img')
    this.translationPanel = page.locator('.translation-panel')
    this.translatedWord = page.locator('.translated-word')
    this.sourceLangLabel = page.locator('#sourceLangLabel')
    this.targetLangLabel = page.locator('#targetLangLabel')
    this.langSwapBtn = page.locator('#langSwapBtn')
    this.sourceTtsBtn = page.locator('#sourceTtsBtn')
    this.targetTtsBtn = page.locator('#targetTtsBtn')
    this.cardTtsBtn = page.locator('#cardTtsBtn')
    this.translitDisplay = page.locator('#translitDisplay')
    this.inputTranslitDisplay = page.locator('#inputTranslitDisplay')
    this.enrichmentPanel = page.locator('#enrichmentPanel')
    this.synonymsList = page.locator('#synonymsList')
    this.examplesList = page.locator('#examplesList')
    this.suggestionsHint = page.locator('#suggestionsHint')
    this.scribeOverlay = page.locator('#cardSaveScribe')
    this.nextWordButton = page.locator('#nextWordBtn')
    this.pumpDoneMessage = page.locator('[data-pump-done]')
    this.pumpBarPosition = page.locator('#pumpBarPosition')
    this.pumpBarTotal = page.locator('#pumpBarTotal')
    this.pumpBarProgressText = page.locator('.pump-bar__progress-text')
    this.pumpBarDoneIcon = page.locator('.pump-bar__progress-done-icon')
}

async goto() {
    // Returning-user state so the first-run welcome picker can't block clicks.
    // No-ops if a test already seeded a study language (e.g. Greek).
    await suppressFirstRunWelcome(this.page)
    await this.page.goto('index.html', {waitUntil: 'networkidle'})
    await this.page.locator('nav.nav-panel > ul > li > a',
        {hasText: 'Translator'}
    )
    .click()
  }

async typeRandomButtons (keys: Locator[], number: number)
: Promise<string> {
    const pressedKeysValues = []
    for (let i = 0; i < number; i++) {
            const randomNumber = Math.floor(Math.random() * keys.length)
            const key =  keys[randomNumber]
            const char = await key.innerText()
            await key.click()
            pressedKeysValues.push(char)
        }
    return pressedKeysValues.join("")
}

async translateInput (input: string) : Promise<void> {
    await this.fillInput(input)
    await this.clickSubmitInput()
}

async fillInput(input: string) {
    await this.inputField.clear()
    await this.inputField.fill(input)
}

async clickSubmitInput () {
    await this.searchButton.click()
}

async clickNextWord () {
    await this.nextWordButton.click()
}

async openSaveModal() {
    await this.saveCardButton.click()
    await expect(this.saveCardModal).not.toHaveClass(/hidden/)
}

}
