import { expect, test, type Page } from '@playwright/test'

import { suppressTabIntros } from '../../page_objects/first-run.js'

/**
 * Phrase Builder lives in its own repo and is registered like any other game, so
 * the host's job is narrow: list it for the languages it declares, launch it
 * without treating it as a card game, and stay out of its way. Its lesson
 * behaviour is covered by a smoke test in the game's own repo.
 */
const lessonGame = {
    name: 'phrase-builder',
    url: '/__stub-lesson.html',
    title: 'Phrase Builder',
    description: 'Learn five words inside one phrase.',
    icon: '✦',
    kind: 'lesson',
    languages: ['el'],
}

async function mockGames(page: Page): Promise<void> {
    await page.route('**/api/translate', route => route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }),
    }))
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
    await page.route('**/__stub-lesson.html', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>Phrase Builder (stub)</title><body>stub',
    }))
    await page.route('**/api/settings', async route => {
        const response = await route.fetch()
        const json = await response.json()
        json.games = [lessonGame]
        json.anonAllowedGames = null
        await route.fulfill({ response, json })
    })
}

// These specs drive the app directly rather than through a page object, so they
// seed the "tab notes already read" state themselves: the note is a modal that
// swallows the nav and game-card clicks below.
test.beforeEach(async ({ page }) => {
    await suppressTabIntros(page)
})

test.describe('Phrase Builder as a registered game', () => {
    test('is hidden for a study language it does not declare', async ({ page }) => {
        await mockGames(page)
        await page.addInitScript(() => {
            window.localStorage.setItem('mainLang', 'es')
            window.localStorage.setItem('sourceLang', 'es')
            window.localStorage.setItem('targetLang', 'en')
        })
        await page.goto('index.html', { waitUntil: 'networkidle' })

        await expect(page.locator('#gamesPage')).toBeVisible()
        await expect(page.locator('#gamesNavLink')).toHaveClass(/active/)
        await expect(page.locator('[data-game-name="phrase-builder"]')).toHaveCount(0)
    })

    test('launches straight into the iframe, with no card gate', async ({ page }) => {
        await mockGames(page)
        await page.addInitScript(() => {
            window.localStorage.setItem('mainLang', 'el')
            window.localStorage.setItem('sourceLang', 'en')
            window.localStorage.setItem('targetLang', 'el')
        })
        // A stored study language skips the welcome overlay, so the path does not
        // run and the grid is reached directly.
        await page.goto('index.html', { waitUntil: 'networkidle' })

        const card = page.locator('[data-game-name="phrase-builder"]')
        await expect(card).toHaveCount(1)
        // A lesson teaches its own words, so it stays open to guests.
        await expect(card).not.toHaveClass(/game-card--locked/)

        await card.click()
        // No resolver, no shortfall modal, no study-set picker — a lesson brings
        // its own content.
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
        await expect(page.locator('#gameShortfallModal')).toHaveCount(0)
    })

    test('does not start the first-run path during a game invite flow', async ({ page }) => {
        await mockGames(page)
        await page.route('**/api/settings', async route => {
            const response = await route.fetch()
            const json = await response.json()
            json.games = [lessonGame]
            json.LOBBY_URL = ''
            await route.fulfill({ response, json })
        })
        await page.goto('index.html?join=test-invite-token', { waitUntil: 'networkidle' })

        const welcome = page.locator('#welcomeOverlay')
        await expect(welcome).toBeVisible()
        await welcome.locator('#welcomeIntroContinue').click()
        await welcome.locator('button[data-lang="el"]').click()
        await welcome.locator('#welcomeStart').click()

        await expect(page.locator('#onboardingPathOverlay')).toBeHidden()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
    })
})
