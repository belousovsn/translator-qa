import { type Page, type Locator } from '@playwright/test'
import { suppressFirstRunWelcome } from './first-run.js'

/** Mirror of the client's OnboardingState shape (see onboardingService.ts). */
export type OnboardingMilestones = {
    translated: boolean
    savedFirstCard: boolean
    reachedCardGoal: boolean
    importedDeck: boolean
    playedGame: boolean
    ranLearning: boolean
}

export type OnboardingStateSeed = {
    startedAt?: number
    dismissed?: boolean
    completedAt?: number | null
    cardsSeen?: number
    milestones?: Partial<OnboardingMilestones>
}

export const ONBOARDING_STORAGE_KEY = 'translator.onboarding.v1'

/**
 * Page object for the onboarding surfaces: the Translator progress chip, the
 * Profile "Getting started" quest, and the first-card Save-button spotlight.
 */
export class OnboardingPage {
    readonly page: Page
    // Translator-page chip
    readonly chip: Locator
    readonly chipMain: Locator
    readonly chipClose: Locator
    readonly chipCount: Locator
    readonly chipFill: Locator
    // Profile quest
    readonly questPanel: Locator
    readonly questHeading: Locator
    readonly questDismiss: Locator
    readonly questSteps: Locator
    readonly questDoneSteps: Locator
    readonly questProgressCount: Locator
    readonly questProgressFill: Locator
    // First-card spotlight
    readonly spotlight: Locator
    readonly spotlightText: Locator
    readonly spotlightDismiss: Locator
    readonly saveButton: Locator
    readonly saveButtonRinged: Locator
    // Navigation + pages
    readonly translatorPage: Locator
    readonly profilePage: Locator
    readonly libraryPage: Locator
    readonly gamesPage: Locator
    readonly profileNavLink: Locator

    constructor(page: Page) {
        this.page = page
        this.chip = page.locator('#onboardingChip')
        this.chipMain = page.locator('[data-onboarding-chip-open]')
        this.chipClose = page.locator('[data-onboarding-chip-close]')
        this.chipCount = page.locator('#onboardingChipCount')
        this.chipFill = page.locator('#onboardingChipFill')

        this.questPanel = page.locator('#onboardingQuestPanel')
        this.questHeading = page.locator('.onboarding-quest-heading .section-title')
        this.questDismiss = page.locator('.onboarding-quest-dismiss')
        this.questSteps = page.locator('.onboarding-quest-step')
        this.questDoneSteps = page.locator('.onboarding-quest-step.is-done')
        this.questProgressCount = page.locator('.onboarding-quest-progress-count')
        this.questProgressFill = page.locator('.onboarding-quest-progress-fill')

        this.spotlight = page.locator('.onboarding-spotlight')
        this.spotlightText = page.locator('.onboarding-spotlight__text')
        this.spotlightDismiss = page.locator('.onboarding-spotlight__dismiss')
        this.saveButton = page.locator('#saveToLearnBtn')
        this.saveButtonRinged = page.locator('#saveToLearnBtn.onboarding-spotlight-target')

        this.translatorPage = page.locator('#translatorPage')
        this.profilePage = page.locator('#profilePage')
        this.libraryPage = page.locator('#libraryPage')
        this.gamesPage = page.locator('#gamesPage')
        this.profileNavLink = page.locator('[data-page="profile"]')
    }

    /** Seed onboarding localStorage before the app boots. Call before goto(). */
    async seedState(seed: OnboardingStateSeed): Promise<void> {
        const state = {
            startedAt: seed.startedAt ?? Date.now(),
            dismissed: seed.dismissed ?? false,
            completedAt: seed.completedAt ?? null,
            cardsSeen: seed.cardsSeen ?? 0,
            milestones: {
                translated: false,
                savedFirstCard: false,
                reachedCardGoal: false,
                importedDeck: false,
                playedGame: false,
                ranLearning: false,
                ...(seed.milestones ?? {}),
            },
        }
        await this.page.addInitScript(
            ([key, value]) => {
                window.localStorage.setItem(key as string, value as string)
            },
            [ONBOARDING_STORAGE_KEY, JSON.stringify(state)] as const,
        )
    }

    /** Read the persisted onboarding state back out of localStorage. */
    async readState(): Promise<OnboardingStateSeed | null> {
        return this.page.evaluate((key) => {
            const raw = window.localStorage.getItem(key)
            return raw ? JSON.parse(raw) : null
        }, ONBOARDING_STORAGE_KEY)
    }

    async goToTranslator(): Promise<void> {
        // Returning-user state so the first-run welcome picker can't block clicks.
        await suppressFirstRunWelcome(this.page)
        await this.page.goto('index.html', { waitUntil: 'networkidle' })
    }

    async openProfile(): Promise<void> {
        await this.profileNavLink.click()
    }
}
