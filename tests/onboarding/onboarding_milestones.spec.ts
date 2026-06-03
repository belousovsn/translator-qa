import { test, expect } from '@playwright/test'
import { OnboardingPage } from '../../page_objects/onboarding-page.js'
import { TranslatorPage } from '../../page_objects/translator-page.js'
import { dogTranslationMockHy } from '../mocks/translationMocks.js'
import { catUnsplashMock } from '../mocks/imageMocks.js'

// NOTE: the other milestone hooks (savedFirstCard, reachedCardGoal via the
// Collection, importedDeck, playedGame, ranLearning) all require a non-anonymous
// session — e.g. the Collection short-circuits to empty for guest scope — so
// they belong in the authenticated test project, not this guest suite. Their
// UI rendering is covered with seeded state in onboarding_quest.spec.ts.

test.describe('Onboarding milestone hooks (guest-reachable)', () => {
    test('translating a word advances the chip from 0/4 to 1/4', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)

        // Only "dog" resolves; the seed-word auto-translate (red/boy/sun/learn)
        // gets WORD_NOT_FOUND so it can't pre-mark the `translated` milestone.
        await page.route('**/api/translate', route => {
            const word = String((route.request().postDataJSON() as { word?: string })?.word ?? '').toLowerCase()
            if (word === 'dog') {
                route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHy) })
            } else {
                route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) })
            }
        })
        await page.route('**/api/images**', route =>
            route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) }),
        )
        await onboarding.seedState({})
        await onboarding.goToTranslator()

        await expect(onboarding.chipCount).toHaveText('0/4')
        await translator.translateInput('dog')
        await expect(onboarding.chipCount).toHaveText('1/4')

        const state = await onboarding.readState()
        expect(state?.milestones?.translated).toBe(true)
    })
})
