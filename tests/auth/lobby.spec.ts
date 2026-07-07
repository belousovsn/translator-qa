import { test, expect, type Page } from '@playwright/test'
import { LobbyPage } from '../../page_objects/lobby-modal.js'

// Live lobby behaviour, driven through the app's Games page. These talk to the
// real lobby service (LOBBY_URL from /api/settings) over socket.io, so they
// verify the whole chain: auth handshake (`lobby:hello` with a real token),
// matchmaking state, room codes, and the match-ticket launch handoff.
//
// Words Tetris is the multiplayer game under test: minPlayers 1 gives it a
// solo path (deterministic single-account launch) while still exercising the
// full lobby machinery.
//
// Serial: all tests share the one disposable account, and the lobby keys
// seats/queues by userId — parallel runs would see each other's rooms.
const GAME = 'words-tetris'

// Keep boot quiet/deterministic: block the seed-word auto-translate.
async function blockTranslate(page: Page): Promise<void> {
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 400, body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }) }),
    )
    await page.route('**/api/images**', route => route.fulfill({ status: 200, body: '[]' }))
}

test.describe('Multiplayer lobby (Words Tetris)', () => {
    test.describe.configure({ mode: 'serial' })

    test('opening a multiplayer game shows the lobby with all matchmaking choices', async ({ page }) => {
        const lobby = new LobbyPage(page)
        await blockTranslate(page)
        await lobby.gotoGames()
        await lobby.openLobbyFor(GAME)

        // Words Tetris allows solo (minPlayers 1), so all four entry points show.
        await expect(lobby.soloButton).toBeVisible()
        await expect(lobby.quickMatchButton).toBeVisible()
        await expect(lobby.createRoomButton).toBeVisible()
        await expect(lobby.codeInput).toBeVisible()
        await expect(lobby.joinButton).toBeVisible()
        // The open-rooms browser rendered (empty state or joinable rooms).
        await expect(lobby.openRoomsList).toBeVisible()
        // Cancel-search is hidden until a queue search is running.
        await expect(lobby.cancelSearchButton).toBeHidden()

        await lobby.closeButton.click()
        await expect(lobby.overlay).toHaveCount(0)
    })

    test('solo play launches a real match and Back returns to the lobby choices', async ({ page }) => {
        const lobby = new LobbyPage(page)
        await blockTranslate(page)
        await lobby.gotoGames()
        await lobby.openLobbyFor(GAME)

        // Solo: the lobby mints a real match ticket and hands off to the game.
        await lobby.soloButton.click()
        await lobby.expectMatchLaunched(GAME)

        // Browser Back is the in-game exit. A solo match has nothing to resume,
        // so it goes straight back to the lobby choices without a Resume banner.
        await page.goBack()
        await expect(lobby.gameOverlay).toHaveClass(/hidden/)
        await expect(lobby.overlay).toBeVisible()
        await expect(lobby.choices).toBeVisible()
        await expect(lobby.resumeBanner).toBeHidden()
        await expect(lobby.status).toHaveText('Choose how to play.')

        // Closing the lobby fully exits to the games grid.
        await lobby.closeButton.click()
        await expect(lobby.overlay).toHaveCount(0)
        await expect(lobby.gamesGrid).toBeVisible()
    })

    test('quick match searches for a second player and can be cancelled', async ({ page }) => {
        const lobby = new LobbyPage(page)
        await blockTranslate(page)
        await lobby.gotoGames()
        await lobby.openLobbyFor(GAME)

        await lobby.quickMatchButton.click()
        // Quick match never auto-solos: it queues and reports progress.
        await expect(lobby.status).toHaveText(/Searching for players… \(1\/\d\)/, { timeout: 15000 })
        await expect(lobby.cancelSearchButton).toBeVisible()

        await lobby.cancelSearchButton.click()
        await expect(lobby.status).toHaveText('Choose how to play.')
        await expect(lobby.cancelSearchButton).toBeHidden()

        await lobby.closeButton.click()
        await expect(lobby.overlay).toHaveCount(0)
    })

    test('creating a room shows its code and members; leaving returns to the choices', async ({ page }) => {
        const lobby = new LobbyPage(page)
        await blockTranslate(page)
        await lobby.gotoGames()
        await lobby.openLobbyFor(GAME)

        await lobby.createRoomButton.click()
        await expect(lobby.roomPanel).toBeVisible({ timeout: 15000 })
        await expect(lobby.choices).toBeHidden()
        await expect(lobby.roomCode).toHaveText(/^[A-Z0-9]{4,6}$/)
        // The host is the only member, listed as such and not ready yet.
        await expect(lobby.members).toHaveCount(1)
        await expect(lobby.members.first()).toContainText('(host)')
        await expect(lobby.members.first()).toContainText('waiting')

        await lobby.leaveButton.click()
        await expect(lobby.choices).toBeVisible()
        await expect(lobby.roomPanel).toBeHidden()

        await lobby.closeButton.click()
        await expect(lobby.overlay).toHaveCount(0)
    })

    test('two players with different study languages join by room code and launch a match', async ({ page, browser }) => {
        // Player A: the signed-in test account (study language hy, normalized in
        // auth.setup). Player B: a guest — the app signs guests in anonymously on
        // demand — seeded with Greek (el) as the study language, so the match is
        // formed from players learning *different* languages. The lobby forwards
        // each player's language in `lobby:hello` for cross-language play.
        const hostLobby = new LobbyPage(page)
        await blockTranslate(page)
        await hostLobby.gotoGames()
        await hostLobby.openLobbyFor(GAME)
        await hostLobby.createRoomButton.click()
        await expect(hostLobby.roomPanel).toBeVisible({ timeout: 15000 })
        const code = (await hostLobby.roomCode.textContent())?.trim() ?? ''
        expect(code).toMatch(/^[A-Z0-9]{4,6}$/)

        // A genuinely fresh guest: newContext() would inherit the project's
        // signed-in storageState (making "both players" the same user, whose
        // lobby seat would just get rebound), so opt out explicitly.
        const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
        try {
            const guestPage = await guestContext.newPage()
            const guestLobby = new LobbyPage(guestPage)
            await blockTranslate(guestPage)
            // Greek study language; also marks the guest as returning so the
            // first-run welcome picker stays closed.
            await guestPage.addInitScript(() => localStorage.setItem('mainLang', 'el'))
            await guestPage.goto('index.html', { waitUntil: 'networkidle' })
            await guestPage.locator('#gamesNavLink').click()

            // Games need a session: the app signs guests in anonymously. If that's
            // disabled on this environment the auth modal appears instead — skip.
            const anonWorked = await guestLobby.gameTile(GAME)
                .waitFor({ state: 'visible', timeout: 15000 })
                .then(() => true, () => false)
            test.skip(!anonWorked, 'anonymous sign-ins unavailable on this environment')

            await guestLobby.openLobbyFor(GAME)
            await guestLobby.codeInput.fill(code)
            await guestLobby.joinButton.click()

            // Both sides now see a 2-member room.
            await expect(guestLobby.roomPanel).toBeVisible({ timeout: 15000 })
            await expect(guestLobby.members).toHaveCount(2)
            await expect(hostLobby.members).toHaveCount(2)

            // Everyone readies up → the lobby signs a match ticket and launches
            // the game for both players.
            await hostLobby.readyButton.click()
            await expect(guestLobby.members.filter({ hasText: 'ready' })).toHaveCount(1)
            await guestLobby.readyButton.click()

            await hostLobby.expectMatchLaunched(GAME)
            await guestLobby.expectMatchLaunched(GAME)

            // Cleanup: the host backs out of the game — a live multiplayer match
            // is resumable, so the lobby offers Resume/Leave — and leaves for good
            // (confirmed) so the room seat is released for future runs.
            page.on('dialog', dialog => dialog.accept())
            await page.goBack()
            await expect(hostLobby.resumeBanner).toBeVisible()
            await hostLobby.resumeLeaveButton.click()
            await expect(hostLobby.resumeBanner).toBeHidden()
            await expect(hostLobby.choices).toBeVisible()
            await hostLobby.closeButton.click()
            await expect(hostLobby.overlay).toHaveCount(0)
        } finally {
            await guestContext.close()
        }
    })
})
