import { test, expect, type Page } from '@playwright/test'
import { OnboardingPage } from '../../page_objects/onboarding-page.js'
import { TranslatorPage } from '../../page_objects/translator-page.js'
import { dogTranslationMockHy } from '../mocks/translationMocks.js'
import { catUnsplashMock } from '../mocks/imageMocks.js'

// These run in the authenticated project (real permanent session via storageState),
// so the milestone hooks that need a non-anonymous user are reachable:
// savedFirstCard, reachedCardGoal (Collection), ranLearning (pump), playedGame,
// and importedDeck. Network is mocked so nothing persists to the real DB.

// A stable pump state with a pending queue. A pending queue means the app does
// NOT auto-translate a seed word on load, keeping the `translated` milestone
// false until a test acts.
function pumpStatus(savedLemmaCount: number, totalLemmaCount: number) {
    return {
        subscribedPackCount: totalLemmaCount > 0 ? 1 : 0,
        savedLemmaCount,
        totalLemmaCount,
        queueDepth: Math.max(0, totalLemmaCount - savedLemmaCount),
        queueDirty: false,
        buildStatus: 'ready',
    }
}

async function mockPump(page: Page): Promise<void> {
    await page.route('**/api/library/initialize', route =>
        route.fulfill({ status: 200, body: JSON.stringify({ ok: true, autoSubscribed: [], queueDirty: false }) }),
    )
    await page.route('**/api/pump/status**', route =>
        route.fulfill({ status: 200, body: JSON.stringify(pumpStatus(0, 2)) }),
    )
    await page.route('**/api/pump/next**', route =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({ done: false, lemmaId: 1, englishLemma: 'dog', position: 1, totalRemaining: 2 }),
        }),
    )
    await page.route('**/api/pump/skip', route => route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }))
}

async function mockTranslate(page: Page): Promise<void> {
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 200, body: JSON.stringify(dogTranslationMockHy) }),
    )
    await page.route('**/api/images**', route =>
        route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) }),
    )
}

test.describe('Onboarding milestone hooks (authenticated)', () => {
    test('saving a card fires savedFirstCard (chip 1/4 → 2/4)', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockPump(page)
        await mockTranslate(page)
        // Mock the save so no real card is written (keeps the test isolated).
        await page.route('**/api/cards/save', route =>
            route.fulfill({ status: 200, body: JSON.stringify({ message: 'saved' }) }),
        )
        await onboarding.seedState({})
        await translator.goto()

        await expect(onboarding.chipCount).toHaveText('0/4')

        await translator.translateInput('dog')
        await expect(onboarding.chipCount).toHaveText('1/4') // translated

        await translator.openSaveModal()
        await translator.saveModalConfirmButton.click()
        await expect.soft(translator.scribeOverlay).toContainText('Card saved to your collection', { timeout: 10000 })

        await expect(onboarding.chipCount).toHaveText('2/4') // + savedFirstCard
        const state = await onboarding.readState()
        expect(state?.milestones?.savedFirstCard).toBe(true)
        expect(state?.cardsSeen ?? 0).toBeGreaterThanOrEqual(1)
    })

    test('a collection of 5 cards completes the save + collection milestones', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockPump(page)
        await page.route('**/api/translate', route =>
            route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
        )
        await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))

        const rows = Array.from({ length: 5 }, (_, i) => ({
            id: `mock-card-${i}`,
            created_at: Date.now() - i * 1000,
            updated_at: Date.now() - i * 1000,
            source_lang: 'en',
            target_lang: 'hy',
            source_word: `word${i}`,
            target_word: `բառ${i}`,
            transliteration: `bar${i}`,
            img_url_small: '',
            img_url_large: '',
            ttsfile: '',
            score: 0,
        }))
        await page.route('**/api/cards', route => route.fulfill({ status: 200, body: JSON.stringify(rows) }))

        await onboarding.seedState({})
        await translator.goto()
        await expect(onboarding.chipCount).toHaveText('0/4')

        // Signed-in scope actually fetches the collection → noteCardCount(5).
        await page.locator('[data-page="dictionary"]').click()
        await expect(page.locator('#dictCount')).toHaveText('5')

        await onboarding.openProfile()
        await expect(onboarding.questProgressCount).toHaveText('2/4')
        await expect(onboarding.questSteps.nth(1)).toHaveClass(/is-done/) // Save your first card
        await expect(onboarding.questSteps.nth(2)).toHaveClass(/is-done/) // Build a collection

        const state = await onboarding.readState()
        expect(state?.milestones?.savedFirstCard).toBe(true)
        expect(state?.milestones?.reachedCardGoal).toBe(true)
        expect(state?.cardsSeen).toBe(5)
    })

    test('using the pump "Next Word" fires ranLearning', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockPump(page)
        await mockTranslate(page)
        await onboarding.seedState({})
        await translator.goto()

        await expect(onboarding.chipCount).toHaveText('0/4')
        await translator.clickNextWord()
        await expect(translator.inputField).toHaveValue('dog')

        // Next Word both translates the lemma and counts as a learning session.
        await expect(onboarding.chipCount).toHaveText('2/4')
        const state = await onboarding.readState()
        expect(state?.milestones?.ranLearning).toBe(true)
        expect(state?.milestones?.translated).toBe(true)
    })

    test('opening a game fires playedGame', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockPump(page)
        // Suppress the seed-word auto-translate so it can't fire other milestones.
        await page.route('**/api/translate', route =>
            route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
        )
        await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))

        // Inject one game into the real settings (keeps real Supabase creds intact).
        await page.route('**/api/settings', async route => {
            const response = await route.fetch()
            const json = await response.json()
            json.games = [{ name: 'test-game', url: 'about:blank', title: 'Test Game', description: 'A test game', icon: '🎮', requires: { minCards: 0 } }]
            json.anonAllowedGames = null
            await route.fulfill({ response, json })
        })
        await page.route('**/api/games/resolve', route =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    qualified: [{ cardId: 'c1', wordId: 1 }],
                    shortfall: 0,
                    requires: { minCards: 0 },
                    remediation: { pumpAvailable: false, starterDeck: null, lemmasInPackTotal: 0, lemmasUserHasInPack: 0 },
                }),
            }),
        )

        await onboarding.seedState({})
        await translator.goto()

        await page.locator('#gamesNavLink').click()
        const gameCard = page.locator('.game-card').first()
        await expect(gameCard).toBeVisible()
        await gameCard.click()

        await expect(page.locator('#gameOverlay')).not.toHaveClass(/hidden/)
        // The opened game iframe is about:blank, which inherits this origin and
        // re-runs the seed init script — clobbering localStorage. So verify the
        // milestone via the chip's in-memory render (toHaveText reads hidden
        // elements too) rather than reading persisted state here.
        await expect(onboarding.chipCount).toHaveText('1/4')
    })

    test('importing a starter deck fires importedDeck', async ({ page }) => {
        const onboarding = new OnboardingPage(page)
        const translator = new TranslatorPage(page)
        await mockPump(page)
        await page.route('**/api/translate', route =>
            route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
        )
        await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
        // Topics may fail to load — harmless for this deck-focused test.
        await page.route('**/api/library/packs**', route => route.fulfill({ status: 200, body: '[]' }))
        await page.route('**/api/library/starter-decks?**', route =>
            route.fulfill({
                status: 200,
                body: JSON.stringify([
                    { slug: 'test-deck', title: 'Test Deck', description: 'A starter deck', cardCount: 10, version: 1, importedByUser: false },
                ]),
            }),
        )
        await page.route('**/api/library/starter-decks/import', route =>
            route.fulfill({ status: 200, body: JSON.stringify({ ok: true, imported: 10, skipped: 0, deckVersion: 1 }) }),
        )

        await onboarding.seedState({})
        await translator.goto()

        // The deck import uses window.confirm — auto-accept it.
        page.on('dialog', dialog => dialog.accept())

        await page.locator('#libraryNavLink').click()
        await page.locator('[data-library-tab="decks"]').click()
        const importBtn = page.locator('[data-deck-import]').first()
        await expect(importBtn).toBeVisible()
        await importBtn.click()

        // markMilestone fires on import success (before the deck list re-renders).
        await expect.poll(async () => (await onboarding.readState())?.milestones?.importedDeck).toBe(true)
    })
})
