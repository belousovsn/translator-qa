import {type Page, type Locator, expect} from '@playwright/test'

export class DictionaryPage {
    readonly page: Page;
    readonly navDictLink: Locator;
    readonly title: Locator;
    readonly cardList: Locator;
    constructor (page: Page) {
        this.page = page
        this.navDictLink = page.locator('nav.nav-panel a[data-page="dictionary"]')
        this.title = page.locator('#dictionaryPage .dictionary-main-panel')
        this.cardList = page.locator('#dictionaryGrid > .dict-card-wrap')
    }

    cardFrontImage(card: Locator) {
        return card.locator('.memo-card-image img').first()
    }
    cardFrontText(card: Locator) {
        return card.locator('.memo-card-text').first()
    }
}
