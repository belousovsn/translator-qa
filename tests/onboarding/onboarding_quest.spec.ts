import { test, expect, type Page } from '@playwright/test'
import { OnboardingPage } from '../../page_objects/onboarding-page.js'

// Keep the chip's counter deterministic: block the seed-word auto-translate so
// the `translated` milestone only flips when a test explicitly translates.
async function blockSeedTranslate(page: Page): Promise<void> {
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
    )
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
}

test.describe('Onboarding quest + Translator chip', () => {
    test('fresh user sees the Translator chip at 0/4', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        await blockSeedTranslate(page)
        await onboarding.seedState({}) // explicit fresh, active state
        await onboarding.goToTranslator()

        await expect(onboarding.chip).toBeVisible()
        await expect(onboarding.chipCount).toHaveText('0/4')
        await expect(onboarding.chipFill).toHaveAttribute('style', /--quest-progress:\s*0%/)
    })

    test('chip reflects seeded progress (2/4, 50%)', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        await blockSeedTranslate(page)
        await onboarding.seedState({ cardsSeen: 2, milestones: { translated: true, savedFirstCard: true } })
        await onboarding.goToTranslator()

        await expect(onboarding.chip).toBeVisible()
        await expect(onboarding.chipCount).toHaveText('2/4')
        await expect(onboarding.chipFill).toHaveAttribute('style', /--quest-progress:\s*50%/)
    })

    test('clicking the chip opens the Profile quest with matching progress', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        await blockSeedTranslate(page)
        await onboarding.seedState({ cardsSeen: 2, milestones: { translated: true, savedFirstCard: true } })
        await onboarding.goToTranslator()

        await onboarding.chipMain.click()

        await expect(onboarding.profilePage).toBeVisible()
        await expect(onboarding.questPanel).toBeVisible()
        await expect(onboarding.questHeading).toHaveText('Getting started')
        await expect(onboarding.questProgressCount).toHaveText('2/4')
        await expect(onboarding.questSteps).toHaveCount(4)
        await expect(onboarding.questDoneSteps).toHaveCount(2)
        // The two completed milestones are the first two steps.
        await expect(onboarding.questSteps.nth(0)).toHaveClass(/is-done/)
        await expect(onboarding.questSteps.nth(1)).toHaveClass(/is-done/)
        await expect(onboarding.questSteps.nth(2)).not.toHaveClass(/is-done/)
    })

    test('quest step actions deep-link into the app', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        await blockSeedTranslate(page)
        await onboarding.seedState({ cardsSeen: 2, milestones: { translated: true, savedFirstCard: true } })
        await onboarding.goToTranslator()
        await onboarding.openProfile()

        // "Build a collection" is the first pending step → its action imports a deck.
        await onboarding.questSteps.nth(2).getByRole('button', { name: 'Import a deck' }).click()
        await expect(onboarding.libraryPage).toBeVisible()
    })

    test('Skip dismisses both surfaces and persists across reload', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        await blockSeedTranslate(page)
        // Fresh (active) and NOT pre-seeded via init script, so the dismissal we
        // write isn't overwritten when the page reloads.
        await onboarding.goToTranslator()

        await expect(onboarding.chip).toBeVisible()
        await onboarding.openProfile()
        await expect(onboarding.questPanel).toBeVisible()

        await onboarding.questDismiss.click()
        await expect(onboarding.questPanel).toBeHidden()

        await page.reload({ waitUntil: 'networkidle' })
        await expect(onboarding.chip).toBeHidden()
        await onboarding.openProfile()
        await expect(onboarding.questPanel).toBeHidden()

        const state = await onboarding.readState()
        expect(state?.dismissed).toBe(true)
    })

    test('completed loop hides the chip but keeps the Profile "all set" panel', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        await blockSeedTranslate(page)
        await onboarding.seedState({
            cardsSeen: 5,
            completedAt: Date.now(),
            milestones: { translated: true, savedFirstCard: true, reachedCardGoal: true, playedGame: true },
        })
        await onboarding.goToTranslator()

        // Chip is a transient nudge — it disappears once the loop is complete.
        await expect(onboarding.chip).toBeHidden()

        // Profile keeps a quiet confirmation.
        await onboarding.openProfile()
        await expect(onboarding.questPanel).toBeVisible()
        await expect(onboarding.questHeading).toHaveText("You're all set")
        await expect(onboarding.questDoneSteps).toHaveCount(4)
    })
})
