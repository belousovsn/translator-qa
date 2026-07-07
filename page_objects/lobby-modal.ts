import { type Page, type Locator, expect } from '@playwright/test'
import { suppressFirstRunWelcome } from './first-run.js'

/**
 * Page Object for the Games page grid and the multiplayer lobby modal
 * (`lobbyController.ts` in the app). The lobby is a real socket.io client
 * against LOBBY_URL, so specs using this object exercise the live lobby
 * service — matchmaking state, room codes, and match launches are real.
 */
export class LobbyPage {
    readonly page: Page
    readonly gamesNavLink: Locator
    readonly gamesGrid: Locator
    /** The whole lobby modal overlay (removed from the DOM on final exit). */
    readonly overlay: Locator
    readonly status: Locator
    readonly choices: Locator
    readonly soloButton: Locator
    readonly quickMatchButton: Locator
    readonly cancelSearchButton: Locator
    readonly createRoomButton: Locator
    readonly codeInput: Locator
    readonly joinButton: Locator
    readonly openRoomsList: Locator
    readonly roomPanel: Locator
    readonly roomCode: Locator
    readonly members: Locator
    readonly readyButton: Locator
    readonly leaveButton: Locator
    readonly closeButton: Locator
    readonly resumeBanner: Locator
    readonly resumeLeaveButton: Locator
    readonly gameOverlay: Locator
    readonly gameFrame: Locator

    constructor(page: Page) {
        this.page = page
        this.gamesNavLink = page.locator('#gamesNavLink')
        this.gamesGrid = page.locator('#gamesGrid')
        this.overlay = page.locator('.lobby-modal-overlay')
        this.status = page.locator('[data-lobby-status]')
        this.choices = page.locator('[data-lobby-choices]')
        this.soloButton = page.locator('[data-lobby-solo]')
        this.quickMatchButton = page.locator('[data-lobby-quick]')
        this.cancelSearchButton = page.locator('[data-lobby-cancel]')
        this.createRoomButton = page.locator('[data-lobby-create]')
        this.codeInput = page.locator('[data-lobby-code]')
        this.joinButton = page.locator('[data-lobby-join]')
        this.openRoomsList = page.locator('[data-lobby-rooms-list]')
        this.roomPanel = page.locator('[data-lobby-room]')
        this.roomCode = page.locator('[data-lobby-room-code]')
        this.members = page.locator('[data-lobby-members] li')
        this.readyButton = page.locator('[data-lobby-ready]')
        this.leaveButton = page.locator('[data-lobby-leave]')
        this.closeButton = page.locator('[data-lobby-close]')
        this.resumeBanner = page.locator('[data-lobby-resume]')
        this.resumeLeaveButton = page.locator('[data-lobby-resume-leave]')
        this.gameOverlay = page.locator('#gameOverlay')
        this.gameFrame = page.locator('#gameFrame')
    }

    gameTile(gameName: string): Locator {
        return this.page.locator(`.game-card[data-game-name="${gameName}"]`)
    }

    /** Boot the app and open the Games page (assumes an authenticated storageState
     *  or a guest the caller has prepared). */
    async gotoGames(): Promise<void> {
        await suppressFirstRunWelcome(this.page)
        await this.page.goto('index.html', { waitUntil: 'networkidle' })
        await this.gamesNavLink.click()
    }

    /** Open a multiplayer game's lobby and wait for the live socket handshake
     *  to land on the "Choose how to play." choices screen. */
    async openLobbyFor(gameName: string): Promise<void> {
        await this.gameTile(gameName).click()
        await expect(this.overlay).toBeVisible()
        // Connecting… → (hello/auth) → Choose how to play.
        await expect(this.status).toHaveText('Choose how to play.', { timeout: 15000 })
        await expect(this.choices).toBeVisible()
    }

    /** Wait until a match has launched: the game iframe is mounted and the
     *  lobby overlay hides itself (it stays in the DOM for rematch). */
    async expectMatchLaunched(gameUrlPart: string): Promise<void> {
        await expect(this.gameOverlay).not.toHaveClass(/hidden/, { timeout: 20000 })
        await expect(this.gameFrame).toHaveAttribute('src', new RegExp(gameUrlPart))
        await expect(this.overlay).toBeHidden()
    }
}
