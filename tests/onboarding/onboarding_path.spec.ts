import { expect, test, type Page } from '@playwright/test'

/**
 * Every step of the path — lesson included — is a registered game in the iframe,
 * so these tests stub both games with pages the host serves. The lesson stub
 * reports `game:result` the way the real Phrase Builder does once it has saved
 * its words; that message is the only thing separating a finished lesson from an
 * abandoned one.
 */
const LESSON_STUB_URL = '/__stub-lesson.html'
const PRACTICE_STUB_URL = '/__stub-practice.html'

const lessonGame = {
    name: 'phrase-builder',
    url: LESSON_STUB_URL,
    title: 'Phrase Builder',
    description: 'Learn five words inside one phrase.',
    icon: '✦',
    kind: 'lesson',
    languages: ['el'],
}

const skywordGame = {
    name: 'skyword',
    url: PRACTICE_STUB_URL,
    title: 'Skyword',
    description: 'A pixel-art sky platformer.',
    icon: '☁️',
    requires: { minCards: 3 },
    onboarding: { completion: 'milestone', milestoneId: 'first-meaningful-loop' },
}

const deckjongGame = {
    ...skywordGame,
    name: 'deckjong',
    title: 'Word Mahjong',
    onboarding: { completion: 'result' },
}

/** A stub game page with separate terminal-result and non-terminal milestone signals. */
function stubGameHtml(label: string, reportResult: boolean, reportMilestone = false, reportPractice = false): string {
    return `<!doctype html><meta charset="utf-8"><title>${label}</title>
<body style="font:16px system-ui;padding:24px">
<h1>${label}</h1>
<script>
  parent.postMessage({ type: 'game:ready', protocolVersion: 1 }, '*')
  addEventListener('message', event => {
    if (event.data?.type === 'translator:init') {
      document.body.dataset.launchPurpose = event.data?.launchContext?.purpose || ''
      document.body.dataset.targetLang = event.data?.targetLang || ''
    }
  })
  ${reportResult
        ? `setTimeout(() => parent.postMessage({ type: 'game:result',
             result: { lessonId: 'stub', wordsSaved: 5, wordsSkipped: 0 } }, '*'), 150)`
        : ''}
  ${reportMilestone
        ? `let milestoneSent = false
           addEventListener('message', event => {
             if (milestoneSent
                 || event.data?.type !== 'translator:init'
                 || event.data?.launchContext?.purpose !== 'onboarding') return
             milestoneSent = true
             setTimeout(() => parent.postMessage({ type: 'game:milestone',
               milestone: { id: 'first-meaningful-loop', progress: 3 } }, '*'), 100)
           })`
        : ''}
  ${reportPractice
        ? `let practiceSent = false
           addEventListener('message', event => {
             if (practiceSent || event.data?.type !== 'translator:init') return
             practiceSent = true
             ;['c1', 'c2', 'c3'].forEach((cardId, index) => parent.postMessage({
               type: 'game:card-practiced',
               practice: { cardId, correct: true, attemptId: 'stub-attempt-' + index },
             }, '*'))
             parent.postMessage({
               type: 'game:card-practiced',
               practice: { cardId: 'c1', correct: true, attemptId: 'stub-attempt-0' },
             }, '*')
           })`
        : ''}
</script>`
}

type PathMockOptions = {
    games?: unknown[]
    lessonReportsResult?: boolean
    practiceReportsResult?: boolean
    practiceReportsMilestone?: boolean
    anonymousSignInFails?: boolean
}

async function mockPathDependencies(page: Page, options: PathMockOptions = {}): Promise<void> {
    await page.route('**/auth/v1/signup', route => {
        if (options.anonymousSignInFails) {
            return route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({
                    code: 400,
                    error_code: 'anonymous_provider_disabled',
                    msg: 'Anonymous sign-ins are disabled',
                }),
            })
        }

        const now = Math.floor(Date.now() / 1000)
        const userId = '00000000-0000-4000-8000-000000000001'
        const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
        const accessToken = [
            base64url({ alg: 'HS256', typ: 'JWT' }),
            base64url({ sub: userId, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 }),
            'test-signature',
        ].join('.')
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                access_token: accessToken,
                token_type: 'bearer',
                expires_in: 3600,
                expires_at: now + 3600,
                refresh_token: 'test-refresh-token',
                user: {
                    id: userId,
                    aud: 'authenticated',
                    role: 'authenticated',
                    app_metadata: { provider: 'anonymous', providers: [] },
                    user_metadata: {},
                    identities: [],
                    is_anonymous: true,
                    created_at: new Date(now * 1000).toISOString(),
                    updated_at: new Date(now * 1000).toISOString(),
                },
            }),
        })
    })
    // The seed translation is irrelevant here and must not race the path.
    await page.route('**/api/translate', route => route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'WORD_NOT_FOUND', error: 'blocked', suggestions: [] }),
    }))
    await page.route('**/api/images**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: '[]',
    }))
    await page.route('**/api/cards', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(['c1', 'c2', 'c3'].map((id, index) => ({
            id,
            source_lang: 'en',
            target_lang: 'el',
            source_word: ['cat', 'dog', 'sun'][index],
            target_word: ['γάτα', 'σκύλος', 'ήλιος'][index],
            img_url_small: '',
            img_url_large: '',
            score: 1,
            hp: 100,
        }))),
    }))
    await page.route('**/api/cards/scores', async route => {
        const request = route.request().postDataJSON() as { scores?: Array<{ cardId: string; score: number }> }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                message: 'Scores updated successfully',
                updates: (request.scores ?? []).map(({ cardId, score }) => ({
                    cardId,
                    previousScore: 0,
                    score,
                    gain: score,
                    hp: 100,
                })),
            }),
        })
    })
    await page.route('**/api/games/resolve', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            ok: true,
            qualified: [
                { cardId: 'c1', wordId: 278 },
                { cardId: 'c2', wordId: 822 },
                { cardId: 'c3', wordId: 933 },
            ],
            shortfall: 0,
            requires: { minCards: 3 },
            remediation: { pumpAvailable: false, starterDeck: null, lemmasInPackTotal: 0, lemmasUserHasInPack: 0 },
        }),
    }))
    await page.route(`**${LESSON_STUB_URL}`, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: stubGameHtml('Phrase Builder (stub)', options.lessonReportsResult !== false),
    }))
    await page.route(`**${PRACTICE_STUB_URL}`, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: stubGameHtml(
            'Practice game (stub)',
            options.practiceReportsResult === true,
            options.practiceReportsMilestone !== false,
            true,
        ),
    }))
    await page.route('**/api/settings', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                // Syntactically valid placeholders keep auth local to the mocks
                // above; this path suite must not create real anonymous users.
                SUPABASE_URL: 'https://onboarding-test.supabase.co',
                SUPABASE_KEY: 'onboarding-test-anon-key',
                games: options.games ?? [lessonGame, skywordGame],
                anonAllowedGames: null,
            }),
        })
    })
}

async function chooseGreek(page: Page): Promise<void> {
    const welcome = page.locator('#welcomeOverlay')
    await expect(welcome).toBeVisible()
    await welcome.locator('button[data-lang="el"]').click()
    await welcome.locator('#welcomeStart').click()
}

/** Wait for the game iframe, then leave it the way a player does. */
async function playAndLeaveGame(page: Page): Promise<void> {
    await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
    // Let the stub deliver game:ready / game:result before backing out.
    await page.waitForTimeout(600)
    await page.goBack()
    await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
}

test.describe('First-run game path', () => {
    test('keeps the language picker over the app until the first lesson is mounted', async ({ page }) => {
        await mockPathDependencies(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await page.evaluate(() => {
            const welcome = document.querySelector<HTMLElement>('#welcomeOverlay')
            const game = document.querySelector<HTMLElement>('#gameOverlay')
            const recordGap = () => {
                if (welcome?.hidden && game?.classList.contains('hidden')) {
                    sessionStorage.setItem('onboarding-uncovered-gap', 'true')
                }
            }
            const observer = new MutationObserver(recordGap)
            if (welcome) observer.observe(welcome, { attributes: true, attributeFilter: ['hidden'] })
            if (game) observer.observe(game, { attributes: true, attributeFilter: ['class'] })
        })

        await chooseGreek(page)

        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
        expect(await page.evaluate(() => sessionStorage.getItem('onboarding-uncovered-gap'))).toBeNull()
    })

    test('marks a lesson launch as onboarding for the embedded game', async ({ page }) => {
        await mockPathDependencies(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)

        const lessonBody = page.locator('#gameOverlay iframe').contentFrame().locator('body')
        await expect(lessonBody).toHaveAttribute('data-launch-purpose', 'onboarding')
        await expect(lessonBody).toHaveAttribute('data-target-lang', 'el')
    })

    test('keeps a failed first lesson visible and retryable', async ({ page }) => {
        await mockPathDependencies(page, { anonymousSignInFails: true })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)

        // Guest auth is the normal fallback for a first lesson. If it is down,
        // sign-in must be visible above onboarding instead of the app appearing
        // to have silently abandoned the flow.
        const auth = page.locator('#authModal')
        await expect(auth).toBeVisible()
        const authZ = await auth.evaluate(element => Number(getComputedStyle(element).zIndex))
        const pathZ = await page.locator('#onboardingPathOverlay')
            .evaluate(element => Number(getComputedStyle(element).zIndex))
        expect(authZ).toBeGreaterThan(pathZ)

        await page.locator('#authModalClose').click()
        const path = page.locator('#onboardingPathOverlay')
        await expect(path.locator('[data-path-step="resume"]')).toBeVisible()
        await expect(path).toContainText('Your first phrase is waiting')
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
        expect(await page.evaluate(
            () => JSON.parse(localStorage.getItem('translator.onboarding.path.v1') ?? '{}').status,
        )).toBe('active')
    })

    test('runs lesson → game → lesson with a neutral practice handoff', async ({ page }) => {
        await mockPathDependencies(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)

        // Step 1 is the lesson game itself — no seam in front of it.
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
        await expect(page.locator('#gameOverlay iframe')).toHaveAttribute('src', /__stub-lesson/)
        await expect(page.locator('#onboardingPathOverlay')).toBeHidden()

        await playAndLeaveGame(page)

        // Seam 1: the point of the whole path — those five words are now a game.
        const path = page.locator('#onboardingPathOverlay')
        await expect(path.locator('[data-path-step="practice-1"]')).toBeVisible()
        await expect(path).toContainText('Five words saved')
        await expect(path).toContainText('Now try playing a game')
        await expect(path.locator('[data-path-continue]')).toHaveText('Start game')
        await path.locator('[data-path-continue]').click()

        await expect(page.locator('#gameOverlay iframe')).toHaveAttribute('src', /__stub-practice/)
        await expect(path).toBeHidden()
        await expect(page.locator('#gameShortfallModal')).toHaveCount(0)

        // The game stays mounted on its success state. The host owns the only
        // continuation action and removes the iframe after the learner chooses it.
        const handoff = page.locator('#practiceSummary')
        await expect(handoff).toBeVisible()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
        await expect(handoff).toContainText('Practice complete')
        await expect(handoff).toContainText('cat → γάτα')
        await expect(handoff.locator('.practice-summary__gain--positive')).toHaveCount(3)
        await handoff.locator('#practiceSummaryContinue').click()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
        await expect(path.locator('[data-path-step="lesson-2"]')).toBeVisible()
        await expect(path).toContainText('Those were your cards')
    })

    test('does not advance when an onboarding game closes before its milestone', async ({ page }) => {
        await mockPathDependencies(page, { practiceReportsMilestone: false })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)
        await playAndLeaveGame(page)

        const path = page.locator('#onboardingPathOverlay')
        await path.locator('[data-path-step="practice-1"] [data-path-continue]').click()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
        await page.goBack()

        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
        await expect(path).toBeHidden()
        await expect
            .poll(async () => await page.evaluate(
                () => JSON.parse(localStorage.getItem('translator.onboarding.path.v1') ?? '{}').status,
            ))
            .toBe('skipped')
    })

    test('accepts a terminal result from a finite onboarding game', async ({ page }) => {
        await mockPathDependencies(page, {
            games: [lessonGame, deckjongGame],
            practiceReportsResult: true,
            practiceReportsMilestone: false,
        })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)
        await playAndLeaveGame(page)

        const path = page.locator('#onboardingPathOverlay')
        await expect(path).toContainText('Now try playing a game')
        await path.locator('[data-path-continue]').click()

        const handoff = page.locator('#practiceSummary')
        await expect(handoff).toBeVisible()
        await expect(handoff).toContainText('Word Mahjong')
        await handoff.locator('#practiceSummaryContinue').click()
        await expect(path.locator('[data-path-step="lesson-2"]')).toBeVisible()
    })

    test('uses the same card-progress summary after an ordinary solo game', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('mainLang', 'el')
            localStorage.setItem('sourceLang', 'en')
            localStorage.setItem('targetLang', 'el')
        })
        await mockPathDependencies(page, {
            games: [skywordGame],
            practiceReportsResult: true,
            practiceReportsMilestone: false,
        })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await page.locator('#gamesNavLink').click()
        await page.locator('[data-game-name="skyword"]').click()

        const summary = page.locator('#practiceSummary')
        await expect(summary).toBeVisible()
        await expect(summary).toContainText('Your card progress')
        await expect(summary.locator('#practiceSummaryContinue')).toHaveText('Back to games')
        await expect(summary.locator('.practice-summary__gain')).toHaveText([
            '+1 card XP',
            '+1 card XP',
            '+1 card XP',
        ])

        await summary.locator('#practiceSummaryContinue').click()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
        await expect(page.locator('#gamesPage')).toBeVisible()
    })

    test('does not start at all where no lesson game is registered', async ({ page }) => {
        // The lesson is the whole premise of the path; without it there is nothing
        // to run, so the user simply lands on the games list.
        await mockPathDependencies(page, { games: [skywordGame] })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)

        await expect(page.locator('#gamesPage')).toBeVisible()
        await expect(page.locator('#onboardingPathOverlay')).toBeHidden()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
        expect(await page.evaluate(
            () => localStorage.getItem('translator.onboarding.path.v1'),
        )).toBeNull()
    })

    test('does not start for a language the lesson game does not cover', async ({ page }) => {
        await mockPathDependencies(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })
        const welcome = page.locator('#welcomeOverlay')
        await expect(welcome).toBeVisible()
        // Spanish is absent from the lesson game's `languages`.
        await welcome.locator('button[data-lang="es"]').click()
        await welcome.locator('#welcomeStart').click()

        await expect(page.locator('#gamesPage')).toBeVisible()
        await expect(page.locator('#onboardingPathOverlay')).toBeHidden()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
    })

    test('skips a practice step whose games are not registered here', async ({ page }) => {
        await mockPathDependencies(page, { games: [lessonGame] })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)
        await playAndLeaveGame(page)

        // No playable game in this environment, so the path steps over the seam
        // instead of offering a button with nothing behind it.
        const path = page.locator('#onboardingPathOverlay')
        await expect(path.locator('[data-path-step="lesson-2"]')).toBeVisible()
        await expect(path.locator('[data-path-step="practice-1"]')).toHaveCount(0)
    })

    test('skip ends the path for good and lands on the games list', async ({ page }) => {
        await mockPathDependencies(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)
        await playAndLeaveGame(page)

        const path = page.locator('#onboardingPathOverlay')
        await expect(path).toBeVisible()
        await path.locator('[data-path-skip]').click()
        await expect(path).toBeHidden()
        await expect(page.locator('#gamesPage')).toBeVisible()

        await page.reload({ waitUntil: 'networkidle' })
        await expect(page.locator('#onboardingPathOverlay')).toBeHidden()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
    })

    test('leaving the first lesson unfinished opts out of the path', async ({ page }) => {
        // The stub never reports a result, so nothing was learned or saved — the
        // next seam would be promising words the player does not have.
        await mockPathDependencies(page, { lessonReportsResult: false })
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)
        await playAndLeaveGame(page)

        await expect(page.locator('#onboardingPathOverlay')).toBeHidden()
        await expect(page.locator('#gamesPage')).toBeVisible()
        await expect
            .poll(async () => await page.evaluate(
                () => JSON.parse(localStorage.getItem('translator.onboarding.path.v1') ?? '{}').status,
            ))
            .toBe('skipped')
    })

    test('re-offers an interrupted step after a reload instead of re-launching it', async ({ page }) => {
        await mockPathDependencies(page)
        await page.goto('index.html', { waitUntil: 'networkidle' })
        await chooseGreek(page)
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)

        await page.reload({ waitUntil: 'networkidle' })

        // The lesson must not reopen by itself — the user gets a card with a button.
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(0)
        const path = page.locator('#onboardingPathOverlay')
        // Resume waits on the settings fetch, which is a real round-trip when the
        // suite runs against a deployed environment rather than localhost.
        await expect(path.locator('[data-path-step="resume"]')).toBeVisible({ timeout: 15_000 })
        await path.locator('[data-path-continue]').click()
        await expect(page.locator('#gameOverlay iframe')).toHaveCount(1)
    })
})
