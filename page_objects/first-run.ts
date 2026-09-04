import { type Page } from '@playwright/test'

/**
 * Suppress the first-run study-language "welcome" picker (`#welcomeOverlay`).
 *
 * The app shows that overlay to brand-new guests — anyone with no `mainLang`
 * in localStorage and no study language saved on their profile. It is a modal
 * (`aria-modal="true"`) that intercepts pointer events, so until it is gone
 * every guest interaction (nav clicks, sign-in buttons, the Save button …) is
 * blocked. Seeding `mainLang` makes the browser look like a returning user so
 * the picker never opens.
 *
 * `mainLang` is the profile study language. The translation pair is locked to
 * `study ↔ English`, so the value here decides which non-English language the
 * Translator can target. Defaults to Armenian (`hy`), the app's own default
 * study language, which keeps the suite's existing assumptions intact.
 *
 * The init script only seeds `mainLang` when it is **not already set**, so a
 * test that pre-seeds a different study language (e.g. Greek via
 * `localStorage.setItem('mainLang', 'el')`) wins regardless of call order.
 * Must be called before the navigation that boots the app.
 */
export async function suppressFirstRunWelcome(page: Page, mainLang: string = 'hy'): Promise<void> {
    await page.addInitScript((lang) => {
        try {
            if (window.localStorage.getItem('mainLang') === null) {
                window.localStorage.setItem('mainLang', lang as string)
            }
        } catch {
            /* storage unavailable — nothing to seed */
        }
    }, mainLang)
}

/**
 * Suppress the one-off "what this tab is for" notes (`.tab-intro-overlay`).
 *
 * The app explains each tab the first time it is opened. The note is built on
 * the same modal shell as the save dialog, so like the welcome picker it sits
 * over the page and intercepts pointer events: a nav click resolves to the
 * link, lands on the overlay, and retries until the test times out.
 *
 * Seeding every tab as already seen makes the browser look like a device that
 * has read them. The app keeps that state under `translator.tabIntro.v1` as a
 * per-tab map, written on dismissal.
 *
 * Like `suppressFirstRunWelcome`, this only seeds when the key is absent, so a
 * test that wants a note on screen can pre-seed its own state and win
 * regardless of call order. Must be called before the navigation that boots
 * the app.
 */
export async function suppressTabIntros(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            if (window.localStorage.getItem('translator.tabIntro.v1') === null) {
                window.localStorage.setItem('translator.tabIntro.v1', JSON.stringify({
                    games: true,
                    dictionary: true,
                    library: true,
                    translator: true,
                }))
            }
        } catch {
            /* storage unavailable — nothing to seed */
        }
    })
}
