import { expect, type Locator, type Page } from '@playwright/test'
import { suppressFirstRunWelcome, suppressTabIntros } from './first-run.js'

/**
 * The Decks page (the nav tab reads "Decks" since #392).
 *
 * It used to be the Library, split into a Topics/Decks tab pair. Topic packs
 * moved to the Translator's Packs sheet, so this page is decks only and there
 * are no tabs left to click.
 */
export class LibraryPage {
    readonly page: Page
    readonly navLink: Locator
    readonly decksGrid: Locator
    readonly ankiImportButton: Locator
    readonly modal: Locator
    readonly fileInput: Locator
    readonly previewButton: Locator

    constructor(page: Page) {
        this.page = page
        this.navLink = page.locator('#libraryNavLink')
        this.decksGrid = page.locator('#libraryDecksGrid')
        this.ankiImportButton = page.locator('#ankiImportOpen')
        this.modal = page.locator('#ankiImportModal')
        this.fileInput = page.locator('#ankiImportFile')
        this.previewButton = page.locator('#ankiImportPreview')
    }

    async goto(): Promise<void> {
        await suppressFirstRunWelcome(this.page)
        await suppressTabIntros(this.page)
        await this.page.goto('index.html', { waitUntil: 'networkidle' })
        await this.navLink.click()
        await expect(this.ankiImportButton).toBeVisible()
    }

    async openAnkiImport(): Promise<void> {
        await this.ankiImportButton.click()
        await expect(this.modal).toBeVisible()
    }

    async uploadPackage(buffer: Buffer, name = 'vocabulary.apkg'): Promise<void> {
        await this.fileInput.setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
        await expect(this.previewButton).toBeEnabled()
        await this.previewButton.click()
    }
}
