import {type Page, type Locator, expect} from '@playwright/test'
import { suppressFirstRunWelcome, suppressTabIntros } from './first-run.js'

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
    readonly senseTabs: Locator;
    readonly selectedSense: Locator;
    readonly synonymChips: Locator;
    readonly exampleItems: Locator;
    readonly enrichmentGrammarChips: Locator;
    readonly enrichmentSkeletonChips: Locator;
    readonly enrichmentEmptyNote: Locator;
    readonly packsOpenButton: Locator;
    readonly packsModal: Locator;
    readonly packsList: Locator;
    readonly packsCloseButton: Locator;
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
    // One meaning per panel since #424: the tabs switch which meaning is shown,
    // and synonyms, examples and grammar all belong to the selected one.
    this.senseTabs = page.locator('#enrichmentSenses .enrichment-sense-tab')
    this.selectedSense = page.locator('#enrichmentSenses .enrichment-sense')
    this.synonymChips = page.locator('#enrichmentSenses .enrichment-block--synonyms .chip')
    this.exampleItems = page.locator('#enrichmentSenses .examples-list .example-item')
    this.enrichmentGrammarChips = page.locator('#enrichmentSenses .enrichment-grammar .chip')
    this.enrichmentSkeletonChips = page.locator('#enrichmentSenses .chip--skeleton')
    this.enrichmentEmptyNote = page.locator('#enrichmentSenses .enrichment-empty-note')
    this.packsOpenButton = page.locator('#packsOpen')
    this.packsModal = page.locator('#packsModal')
    this.packsList = page.locator('#packsList')
    this.packsCloseButton = page.locator('#packsModalClose')
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
    await suppressTabIntros(this.page)
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

/** Switch the enrichment panel to another meaning of the same word. */
async selectSense(label: string | RegExp) {
    await this.senseTabs.filter({ hasText: label }).click()
}

/** Open the Packs sheet from the pump bar (Translator, #392). */
async openPacks() {
    await this.packsOpenButton.click()
    await expect(this.packsModal).not.toHaveClass(/hidden/)
}

async openSaveModal() {
    await this.saveCardButton.click()
    await expect(this.saveCardModal).not.toHaveClass(/hidden/)
}

}
