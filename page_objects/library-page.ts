import { expect, type Locator, type Page } from '@playwright/test'
import { suppressFirstRunWelcome } from './first-run.js'

export class LibraryPage {
    readonly page: Page
    readonly navLink: Locator
    readonly decksTab: Locator
    readonly ankiImportButton: Locator
    readonly modal: Locator
    readonly fileInput: Locator
    readonly previewButton: Locator

    constructor(page: Page) {
        this.page = page
        this.navLink = page.locator('#libraryNavLink')
        this.decksTab = page.locator('[data-library-tab="decks"]')
        this.ankiImportButton = page.locator('#ankiImportOpen')
        this.modal = page.locator('#ankiImportModal')
        this.fileInput = page.locator('#ankiImportFile')
        this.previewButton = page.locator('#ankiImportPreview')
    }

    async goto(): Promise<void> {
        await suppressFirstRunWelcome(this.page)
        await this.page.goto('index.html', { waitUntil: 'networkidle' })
        await this.navLink.click()
        await this.decksTab.click()
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
