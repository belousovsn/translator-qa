import { expect, type Page } from '@playwright/test'

/**
 * Leave the welcome intro and arrive at the study-language tiles.
 *
 * Where cross-translation is on, the visitor first confirms their own language. Where it is
 * off, the app goes straight to the study language. Both end on `#welcomeLanguageStep`.
 */
export async function continueToStudyLanguages(page: Page): Promise<void> {
    await page.locator('#welcomeIntroContinue').click()
    const studyStep = page.locator('#welcomeLanguageStep')
    const baseStep = page.locator('#welcomeBaseLanguageStep')
    await expect(studyStep.or(baseStep).first()).toBeVisible()
    if (await baseStep.isVisible()) await page.locator('#welcomeBaseContinue').click()
    await expect(studyStep).toBeVisible()
}

/** Pick a study language in the welcome and start. */
export async function chooseStudyLanguage(page: Page, lang: string): Promise<void> {
    await expect(page.locator('#welcomeOverlay')).toBeVisible()
    await continueToStudyLanguages(page)
    await page.locator(`#welcomeLangGrid button[data-lang="${lang}"]`).click()
    await page.locator('#welcomeStart').click()
}
