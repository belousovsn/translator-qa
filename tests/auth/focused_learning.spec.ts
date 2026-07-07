import { test, expect, type Page } from '@playwright/test'
import { suppressFirstRunWelcome } from '../../page_objects/first-run.js'

// Focused learning ("study set"): on the Games page the player can narrow games
// to a hand-picked set of cards instead of the whole collection. The selection
// is stored per study language (`translator.gameStudySet:<lang>`) and sent to
// POST /api/games/resolve as `focus: { mode: 'cards', cardIds }`.
//
// The signed-in account's study language is Armenian (hy, normalized in
// auth.setup). The mocked collection deliberately mixes languages — the picker
// and the focus flow must only ever surface cards of the *current* study
// language, which is the cross-language scenario under test here.

// Mixed-language collection: 3 eligible en→hy cards, 1 en→el card (wrong
// language), and 1 en→hy card without word_id (not game-eligible).
// Distinct creation times (apple newest) so the picker's default date-desc
// sort yields a deterministic order.
const CARD_ROWS = [
    row('hy-apple', 'en', 'hy', 'apple', 'խնձոր', 101, 0, 0),
    row('hy-bread', 'en', 'hy', 'bread', 'հաց', 102, 0.5, 1),
    row('hy-water', 'en', 'hy', 'water', 'ջուր', 103, 0.9, 2),
    row('el-dog', 'en', 'el', 'dog', 'σκύλος', 201, 0, 3),
    { ...row('hy-legacy', 'en', 'hy', 'legacy', 'հին', 0, 0, 4), word_id: null },
]

function row(id: string, source: string, target: string, sourceWord: string, targetWord: string, wordId: number, score: number, ageMinutes: number) {
    return {
        id,
        created_at: Date.now() - ageMinutes * 60_000,
        updated_at: Date.now(),
        source_lang: source,
        target_lang: target,
        source_word: sourceWord,
        target_word: targetWord,
        transliteration: '',
        img_url_small: 'https://picsum.photos/seed/qa/120/80',
        img_url_large: 'https://picsum.photos/seed/qa/400/260',
        ttsfile: '',
        score,
        word_id: wordId,
    }
}

const STUDY_SET_KEY = 'translator.gameStudySet:hy'

async function mockAppBackend(page: Page): Promise<void> {
    // Keep the boot deterministic: no seed auto-translate, quiet pump.
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
    )
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
    await page.route('**/api/library/initialize', route =>
        route.fulfill({ status: 200, body: JSON.stringify({ ok: true, autoSubscribed: [], queueDirty: false }) }),
    )
    await page.route('**/api/pump/status**', route =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({
                subscribedPackCount: 1, savedLemmaCount: 0, totalLemmaCount: 2,
                queueDepth: 2, queueDirty: false, buildStatus: 'ready',
            }),
        }),
    )
    await page.route('**/api/cards', route => route.fulfill({ status: 200, body: JSON.stringify(CARD_ROWS) }))
}

// Replace the games list with one simple solo game (keeps real Supabase creds).
async function injectTestGame(page: Page, minCards: number): Promise<void> {
    await page.route('**/api/settings', async route => {
        const response = await route.fetch()
        const json = await response.json()
        json.games = [{
            name: 'test-game', url: 'about:blank', title: 'Test Game',
            description: 'A test game', icon: '🎮', requires: { minCards },
        }]
        json.anonAllowedGames = null
        await route.fulfill({ response, json })
    })
}

async function gotoGames(page: Page): Promise<void> {
    await suppressFirstRunWelcome(page)
    await page.goto('index.html', { waitUntil: 'networkidle' })
    await page.locator('#gamesNavLink').click()
}

const picker = {
    modal: '#gameStudyModal',
    options: '#gameStudyPickerList .game-study-card-option',
    checkbox: (cardId: string) => `input[data-game-study-card-id="${cardId}"]`,
    count: '#gameStudyPickerCount',
    save: '#gameStudySave',
}

test.describe('Focused learning (game study set)', () => {
    test('defaults to all eligible cards and the picker only offers current-language cards', async ({ page }) => {
        await mockAppBackend(page)
        await injectTestGame(page, 2)
        await gotoGames(page)

        await expect(page.locator('#gameStudySetTitle')).toHaveText('All eligible cards')
        await expect(page.locator('[data-game-study-mode="default"]')).toHaveClass(/is-active/)

        await page.locator('#gameStudyEdit').click()
        await expect(page.locator(picker.modal)).toBeVisible()
        await expect(page.locator('#gameStudyModalSub')).toHaveText('Focused game cards for Armenian.')

        // Only the 3 eligible Armenian cards — the Greek card and the card
        // without a word id are filtered out of the mixed collection.
        await expect(page.locator(picker.options)).toHaveCount(3)
        await expect(page.locator(picker.options)).toContainText([
            'apple -> խնձոր',
            'bread -> հաց',
            'water -> ջուր',
        ])
        await expect(page.locator('#gameStudyPickerList')).not.toContainText('σκύλος')
        await expect(page.locator('#gameStudyPickerList')).not.toContainText('legacy')
    })

    test('saving a selection switches to a focused study set and persists it per language', async ({ page }) => {
        await mockAppBackend(page)
        await injectTestGame(page, 2)
        await gotoGames(page)

        // Switching to "Selected cards" with nothing chosen opens the picker.
        await page.locator('[data-game-study-mode="cards"]').click()
        await expect(page.locator(picker.modal)).toBeVisible()

        await page.locator(picker.checkbox('hy-apple')).check()
        await page.locator(picker.checkbox('hy-bread')).check()
        await expect(page.locator(picker.count)).toHaveText('2 selected')
        await page.locator(picker.save).click()

        await expect(page.locator(picker.modal)).toBeHidden()
        await expect(page.locator('#gameStudySetTitle')).toHaveText('2 selected cards')
        await expect(page.locator('[data-game-study-mode="cards"]')).toHaveClass(/is-active/)

        const stored = await page.evaluate(
            (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'),
            STUDY_SET_KEY,
        )
        expect(stored).toEqual({ mode: 'cards', cardIds: ['hy-apple', 'hy-bread'] })
    })

    test('launching a game sends the focused card ids to the resolver', async ({ page }) => {
        await mockAppBackend(page)
        await injectTestGame(page, 2)
        await page.addInitScript(
            (key) => localStorage.setItem(key, JSON.stringify({ mode: 'cards', cardIds: ['hy-apple', 'hy-bread'] })),
            STUDY_SET_KEY,
        )

        let resolveBody: Record<string, unknown> | null = null
        await page.route('**/api/games/resolve', route => {
            resolveBody = route.request().postDataJSON() as Record<string, unknown>
            return route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    qualified: [{ cardId: 'hy-apple', wordId: 101 }, { cardId: 'hy-bread', wordId: 102 }],
                    shortfall: 0,
                    requires: { minCards: 2 },
                    focus: { mode: 'cards', requestedCardCount: 2, matchedCardCount: 2 },
                    remediation: { pumpAvailable: false, starterDeck: null, lemmasInPackTotal: 0, lemmasUserHasInPack: 0 },
                }),
            })
        })

        await gotoGames(page)
        await page.locator('.game-card[data-game-name="test-game"]').click()

        await expect(page.locator('#gameOverlay')).not.toHaveClass(/hidden/)
        expect(resolveBody).toMatchObject({
            gameName: 'test-game',
            targetLang: 'hy',
            focus: { mode: 'cards', cardIds: ['hy-apple', 'hy-bread'] },
        })
    })

    test('a focused set with no matching cards reopens the picker instead of starting', async ({ page }) => {
        await mockAppBackend(page)
        await injectTestGame(page, 2)
        // A stale selection, e.g. cards deleted since (or saved for another language).
        await page.addInitScript(
            (key) => localStorage.setItem(key, JSON.stringify({ mode: 'cards', cardIds: ['gone-card'] })),
            STUDY_SET_KEY,
        )
        await page.route('**/api/games/resolve', route =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    qualified: [],
                    shortfall: 2,
                    requires: { minCards: 2 },
                    focus: { mode: 'cards', requestedCardCount: 1, matchedCardCount: 0 },
                    remediation: { pumpAvailable: false, starterDeck: null, lemmasInPackTotal: 0, lemmasUserHasInPack: 0 },
                }),
            }),
        )

        await gotoGames(page)
        await page.locator('.game-card[data-game-name="test-game"]').click()

        await expect(page.locator(picker.modal)).toBeVisible()
        await expect(page.locator('#gameOverlay')).toHaveClass(/hidden/)
    })

    test('the shortfall dialog explains how many selected cards match', async ({ page }) => {
        await mockAppBackend(page)
        await injectTestGame(page, 10)
        await page.addInitScript(
            (key) => localStorage.setItem(key, JSON.stringify({ mode: 'cards', cardIds: ['hy-apple', 'el-dog'] })),
            STUDY_SET_KEY,
        )
        // One of the two selected cards is Greek, so only one matches this
        // Armenian game — and it's still short of the 10-card requirement.
        await page.route('**/api/games/resolve', route =>
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    ok: true,
                    qualified: [{ cardId: 'hy-apple', wordId: 101 }],
                    shortfall: 9,
                    requires: { minCards: 10 },
                    focus: { mode: 'cards', requestedCardCount: 2, matchedCardCount: 1 },
                    remediation: { pumpAvailable: false, starterDeck: null, lemmasInPackTotal: 0, lemmasUserHasInPack: 0 },
                }),
            }),
        )

        await gotoGames(page)
        await page.locator('.game-card[data-game-name="test-game"]').click()

        const modal = page.locator('#gameShortfallModal')
        await expect(modal).toBeVisible()
        await expect(modal).toContainText('This game needs 10 cards from your selected study set. You have 1 (1 of 2 selected match).')

        // The remediation offered for a focused shortfall is editing the selection.
        await modal.locator('[data-game-choose-cards]').click()
        await expect(modal).toHaveCount(0)
        await expect(page.locator(picker.modal)).toBeVisible()
    })

    test('the study set is scoped to the study language', async ({ page }) => {
        await mockAppBackend(page)
        await injectTestGame(page, 2)
        // A focused set saved for Greek must not leak into the Armenian games page.
        await page.addInitScript(() =>
            localStorage.setItem('translator.gameStudySet:el', JSON.stringify({ mode: 'cards', cardIds: ['el-dog'] })),
        )

        await gotoGames(page)
        await expect(page.locator('#gameStudySetTitle')).toHaveText('All eligible cards')
        await expect(page.locator('[data-game-study-mode="default"]')).toHaveClass(/is-active/)
    })
})
