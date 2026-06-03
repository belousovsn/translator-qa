import {type Page, type Locator, expect} from '@playwright/test'


export class Auth {
    readonly page : Page;
    readonly profileNavLink : Locator;
    readonly profilePrimaryAction: Locator;
    readonly authModal: Locator;
    readonly emailInput: Locator;
    readonly passwordInput: Locator;
    readonly signInButton: Locator;
    readonly navUserEmailLabel: Locator;

    constructor (page: Page) {
        this.page = page;
        this.profileNavLink = page.locator('#profileNavLink')
        this.profilePrimaryAction = page.locator('#profilePrimaryAction')
        this.authModal = page.locator('#authModalTitle')
        this.emailInput = page.locator('#authEmail')
        this.passwordInput = page.locator('#authPassword')
        this.signInButton = page.locator('#authSubmit')
        this.navUserEmailLabel = page.locator('#navUserEmail')
    }

    async startAuth () {
        await this.profileNavLink.click()
        await expect(this.profilePrimaryAction).toBeVisible()
        await this.profilePrimaryAction.click()
        await expect(this.authModal).toBeVisible()
    }

    async enterEmail (email: string) {
        await this.emailInput.fill(email.trim().toLowerCase())
    }
    async enterPassword (password: string) {
        await this.passwordInput.fill(password)
    }
    async signInButtonClick () {
        await this.signInButton.click()
    }
    async isUserSignedIn (email: string) {
        await expect(this.navUserEmailLabel).toContainText(email)
    }
    async isAuthPageClosed () {
        await expect(this.authModal).not.toBeVisible()
    }
    async signIn (email: string, password: string) {
        await this.startAuth()
        await this.enterEmail(email)
        await this.enterPassword(password)
        await this.signInButtonClick()
        await this.isUserSignedIn(email)
        await this.isAuthPageClosed()
    }
}
