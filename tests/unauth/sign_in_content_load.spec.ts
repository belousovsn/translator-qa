import { expect, test, type Page } from '@playwright/test'
import { Auth } from '../../page_objects/auth-modal.js'
import { suppressFirstRunWelcome } from '../../page_objects/first-run.js'
import { TEST_EMAIL, TEST_PASSWORD } from '../../src/config.js'

async function mockSignedInBackgroundRequests(page: Page) {
    await page.route('**/api/library/initialize', route =>
        route.fulfill({ status: 200, body: JSON.stringify({ ok: true, autoSubscribed: [], queueDirty: false }) }),
    )
    await page.route('**/api/pump/status**', route =>
        route.fulfill({
            status: 200,
            body: JSON.stringify({
                subscribedPackCount: 0,
                savedLemmaCount: 0,
                totalLemmaCount: 0,
                queueDepth: 0,
                queueDirty: false,
                buildStatus: 'ready',
            }),
        }),
    )
    await page.route('**/api/pump/next**', route =>
        route.fulfill({ status: 200, body: JSON.stringify({ done: true, totalRemaining: 0 }) }),
    )
}

async function signInFromOpenModal(page: Page) {
    const auth = new Auth(page)
    await expect(auth.authModal).toBeVisible()
    await auth.enterEmail(TEST_EMAIL)
    await auth.enterPassword(TEST_PASSWORD)
    await auth.signInButtonClick()
    await auth.isUserSignedIn(TEST_EMAIL)
    await auth.isAuthPageClosed()
}

test('library loads content immediately after signing in from the visible page', async ({ page }) => {
    await mockSignedInBackgroundRequests(page)
    await page.route('**/api/library/packs**', route =>
        route.fulfill({
            status: 200,
            body: JSON.stringify([
                {
                    slug: 'daily-life',
                    title: 'Daily Life',
                    description: 'Everyday words.',
                    subscribed: true,
                    current_tier_level: 0,
                    tier_count: 1,
                    is_max_tier: true,
                    saved_count_in_tier: 1,
                    lemma_count_in_tier: 10,
                    tier_progress: 0.1,
                    advance_threshold: 0.8,
                    can_advance: false,
                    saved_count_total: 1,
                    lemma_count_total: 10,
                },
            ]),
        }),
    )
    await page.route('**/api/library/starter-decks**', route =>
        route.fulfill({ status: 200, body: JSON.stringify([]) }),
    )

    await suppressFirstRunWelcome(page)
    await page.goto('index.html', { waitUntil: 'networkidle' })
    await page.locator('nav.nav-panel a[data-page="library"]').click()
    await expect(page.locator('[data-library-login]')).toBeVisible()

    await page.locator('[data-library-login]').click()
    await signInFromOpenModal(page)

    await expect(page.locator('#libraryTopicsGrid [data-library-pack][data-pack-slug="daily-life"]')).toBeVisible()
    await expect(page.locator('#libraryTopicsGrid')).toContainText('Daily Life')
})

test('collection loads content immediately after signing in from the visible page', async ({ page }) => {
    await mockSignedInBackgroundRequests(page)
    await page.route('**/api/cards', route =>
        route.fulfill({
            status: 200,
            body: JSON.stringify([
                {
                    id: 'card-after-signin',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                    source_lang: 'en',
                    target_lang: 'hy',
                    source_word: 'cat',
                    target_word: 'katu',
                    transliteration: 'katu',
                    img_url_small: 'https://picsum.photos/seed/cat/120/80',
                    img_url_large: 'https://picsum.photos/seed/cat/400/260',
                    user_id: 'user-after-signin',
                    ttsfile: '',
                    score: 0,
                    word_id: 101,
                },
            ]),
        }),
    )

    await suppressFirstRunWelcome(page)
    await page.goto('index.html', { waitUntil: 'networkidle' })
    await page.locator('nav.nav-panel a[data-page="dictionary"]').click()
    await expect(page.locator('[data-dictionary-signin]')).toBeVisible()

    await page.locator('[data-dictionary-signin]').click()
    await signInFromOpenModal(page)

    await expect(page.locator('#dictionaryGrid > .dict-card-wrap')).toBeVisible()
    await expect(page.locator('#dictionaryGrid')).toContainText('cat')
})
