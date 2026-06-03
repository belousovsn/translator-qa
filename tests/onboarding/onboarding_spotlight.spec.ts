import { test, expect, type Page } from '@playwright/test'
import { OnboardingPage } from '../../page_objects/onboarding-page.js'
import { TranslatorPage } from '../../page_objects/translator-page.js'
import { dogTranslationMockHy } from '../mocks/translationMocks.js'
import { catUnsplashMock } from '../mocks/imageMocks.js'

// A successful translation surfaces the Save button, which is what the
// first-card spotlight anchors to.
async function mockSuccessfulTranslation(page: Page): Promise<void> {
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHy) }),
    )
    await page.route('**/api/images**', route =>
        route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) }),
    )
}

test.describe('First-card guided spotlight', () => {
    test('appears on the Save button after the first translation', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockSuccessfulTranslation(page)
        await onboarding.seedState({}) // fresh user, no saved card yet
        await onboarding.goToTranslator()

        await translator.translateInput('dog')

        await expect(translator.saveCardButton).toBeVisible()
        await expect(onboarding.spotlight).toHaveClass(/is-visible/)
        await expect(onboarding.spotlightText).toHaveText('Save this word to start your collection.')
        await expect(onboarding.saveButtonRinged).toBeVisible() // pulsing ring on the target

        // Translating also advanced the chip's `translated` milestone.
        await expect(onboarding.chipCount).toHaveText('1/4')
    })

    test('"Maybe later" dismisses it and it does not return on the next translation', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockSuccessfulTranslation(page)
        await onboarding.seedState({})
        await onboarding.goToTranslator()

        await translator.translateInput('dog')
        await expect(onboarding.spotlight).toHaveClass(/is-visible/)

        await onboarding.spotlightDismiss.click()
        await expect(onboarding.spotlight).not.toHaveClass(/is-visible/)
        await expect(onboarding.saveButtonRinged).toHaveCount(0)

        // Retired for the session — a second translation must not re-show it.
        await translator.translateInput('dog')
        await expect(translator.saveCardButton).toBeVisible()
        await expect(page.locator('.onboarding-spotlight.is-visible')).toHaveCount(0)
    })

    test('does not appear for users who have already saved a card', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockSuccessfulTranslation(page)
        await onboarding.seedState({ cardsSeen: 1, milestones: { savedFirstCard: true } })
        await onboarding.goToTranslator()

        await translator.translateInput('dog')

        await expect(translator.saveCardButton).toBeVisible()
        await expect(page.locator('.onboarding-spotlight.is-visible')).toHaveCount(0)
        await expect(onboarding.saveButtonRinged).toHaveCount(0)
    })
})
