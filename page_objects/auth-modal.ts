import {type Page, type Locator, expect} from '@playwright/test'

/**
 * Budget for a live Supabase email/password sign-in to land in the UI.
 *
 * Generous because it is one real round trip against a shared account: several
 * specs sign the same user in while the run is under way, and the slow one waits
 * with the Sign In button disabled. The app answers in well under a second — this
 * is queueing, not product latency.
 */
const AUTH_ROUND_TRIP_TIMEOUT_MS = 30_000

/** How many times a sign-in that failed on the network is submitted again. */
const MAX_TRANSIENT_RESUBMITS = 2

/**
 * The modal's error after a 502-504 or a dropped connection at Supabase auth. The app
 * printed the raw error, `{}`, until Translator-app fixed the message; both are accepted so
 * the suite works against either build. Anything else (a wrong password) is not retried.
 */
function isTransientSignInError (text: string): boolean {
    const message = text.trim()
    return message === '{}' || /could not reach the sign-in service/i.test(message)
}


export class Auth {
    readonly page : Page;
    readonly profileNavLink : Locator;
    readonly profilePrimaryAction: Locator;
    readonly authModal: Locator;
    readonly emailInput: Locator;
    readonly passwordInput: Locator;
    readonly signInButton: Locator;
    readonly navUserEmailLabel: Locator;
    readonly authError: Locator;

    constructor (page: Page) {
        this.page = page;
        this.profileNavLink = page.locator('#profileNavLink')
        this.profilePrimaryAction = page.locator('#profilePrimaryAction')
        this.authModal = page.locator('#authModalTitle')
        this.emailInput = page.locator('#authEmail')
        this.passwordInput = page.locator('#authPassword')
        this.signInButton = page.locator('#authSubmit')
        this.navUserEmailLabel = page.locator('#navUserEmail')
        this.authError = page.locator('#authError')
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
    // Sign-in is the one step that waits on a real Supabase auth round trip (the
    // rest of the suite is route-mocked), so it gets a budget of its own. The
    // default 5s expect timeout made this the suite's only recurring flake:
    // `#navUserEmail` was still empty when a slow/throttled auth call came back.
    // With the budget raised it still flaked four nights out of 21 in September.
    // The traces were lost, but an API spec caught the likely cause on 12 Sep: a
    // 502-504 from Supabase auth. In the UI that leaves an error in the modal while
    // the test waits out the 30 s, so such an attempt is submitted again.
    async isUserSignedIn (email: string) {
        let resubmits = 0
        await expect(async () => {
            if (resubmits < MAX_TRANSIENT_RESUBMITS
                && await this.authError.isVisible()
                && isTransientSignInError(await this.authError.innerText())) {
                resubmits++
                await this.signInButton.click()
            }
            await expect(this.navUserEmailLabel).toContainText(email, { timeout: 2_000 })
        }).toPass({ timeout: AUTH_ROUND_TRIP_TIMEOUT_MS })
    }
    async isAuthPageClosed () {
        await expect(this.authModal).not.toBeVisible({ timeout: AUTH_ROUND_TRIP_TIMEOUT_MS })
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
