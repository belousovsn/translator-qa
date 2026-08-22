import { type Page } from '@playwright/test'
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
    completedAt?: number | null
    cardsSeen?: number
    milestones?: Partial<OnboardingMilestones>
}

export const ONBOARDING_STORAGE_KEY = 'translator.onboarding.v1'

/**
 * Seeds and reads the activation-milestone record. The checklist UI these
 * milestones used to drive is gone (the first-run path replaced it); the record
 * itself lives on as the activation funnel, so the tests assert it directly.
 */
export class OnboardingPage {
    readonly page: Page

    constructor(page: Page) {
        this.page = page
    }

    /** Seed onboarding localStorage before the app boots. Call before goto(). */
    async seedState(seed: OnboardingStateSeed): Promise<void> {
        const state = {
            startedAt: seed.startedAt ?? Date.now(),
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
        await this.page.goto('index.html?view=translator', { waitUntil: 'networkidle' })
    }
}
