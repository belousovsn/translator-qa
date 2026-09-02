import { expect, test } from '@playwright/test'

const productionStudyLanguages = [
    ['hy', 'Armenian'],
    ['el', 'Greek'],
    ['ru', 'Russian'],
    ['es', 'Spanish'],
    ['ja', 'Japanese'],
    ['de', 'German'],
    ['fr', 'French'],
    ['it', 'Italian'],
    ['pt', 'Portuguese'],
    ['hr', 'Croatian'],
    ['tr', 'Turkish'],
    ['uk', 'Ukrainian'],
    ['sr', 'Serbian'],
    ['ar', 'Arabic'],
    ['zh', 'Chinese'],
    ['ko', 'Korean'],
] as const

const languageSettings = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_KEY: 'test-anon-key',
    enabledLanguages: ['en', ...productionStudyLanguages.map(([code]) => code)],
    languages: productionStudyLanguages.slice(6).map(([code, englishName], index) => ({
        code,
        englishName,
        nativeName: englishName,
        shortLabel: code.toUpperCase(),
        glyph: code.toUpperCase(),
        apiCode: code,
        dbCodes: [code],
        scriptSource: '',
        supportsTransliteration: false,
        textDirection: code === 'ar' ? 'rtl' : 'ltr',
        locale: code,
        sortOrder: 100 + index,
    })),
}

const publicRoutes = [
    '/',
    '/languages/',
    '/learn/english-armenian/',
    '/decks/',
    '/decks/starter-vocabulary/',
    '/decks/greetings-vocabulary/',
    '/decks/travel-vocabulary/',
    '/decks/food-vocabulary/',
    '/decks/family-vocabulary/',
    '/games/',
    '/collection/',
    '/help.html',
    '/contact.html',
    '/privacy.html',
    '/terms.html',
    '/third-party-games.html',
]

// The English content surface (docs, blog, trust pages). It ships complete in
// the initial HTML and is the half of the site a retrieval system actually
// quotes, so it gets the same metadata gate as the acquisition pages.
const contentRoutes = [
    '/en/docs/',
    '/en/docs/what-is-memdecks/',
    '/en/docs/supported-languages/',
    '/en/docs/add-your-first-words/',
    '/en/docs/start-learning/',
    '/en/docs/how-a-session-works/',
    '/en/docs/learning-modes/',
    '/en/docs/card-progress/',
    '/en/docs/word-cards/',
    '/en/docs/decks-and-packs/',
    '/en/docs/games/',
    '/en/docs/multiplayer/',
    '/en/docs/spaced-repetition/',
    '/en/docs/where-words-come-from/',
    '/en/docs/glossary/',
    '/en/docs/faq/',
    '/en/blog/',
    '/en/blog/how-memdecks-decides-when-to-show-a-card-again/',
    '/en/blog/learning-a-non-latin-alphabet/',
    '/en/blog/vocabulary-inside-a-phrase/',
    '/en/blog/games-as-retrieval-practice/',
    '/en/blog/first-200-words/',
    '/en/blog/authors/sergey-belousov/',
    '/en/pricing/',
    '/en/about/',
    '/en/compare/anki/',
    '/en/compare/duolingo/',
    '/en/compare/quizlet/',
]

const allIndexableRoutes = [...publicRoutes, ...contentRoutes]

test.describe('public SEO surface', () => {
    for (const route of allIndexableRoutes) {
        test(`${route} has complete indexable metadata`, async ({ page }) => {
            await page.goto(route, { waitUntil: 'domcontentloaded' })

            await expect(page.locator('h1')).toHaveCount(1)
            expect(await page.title()).not.toBe('')
            await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{40,}/)
            await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/memdecks\.com\//)
            await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /memdecks-social\.png$/)
            await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
        })
    }

    test('acquisition pages do not overflow a mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        for (const route of ['/languages/', '/learn/english-armenian/', '/decks/', '/decks/travel-vocabulary/', '/games/', '/collection/']) {
            await page.goto(route, { waitUntil: 'domcontentloaded' })
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
            }))
            expect(dimensions.content, `${route} has horizontal overflow`).toBeLessThanOrEqual(dimensions.viewport + 1)
        }
    })

    test('shared deck pages reflect and preserve every production study language', async ({ page }) => {
        test.setTimeout(90_000)
        await page.route('**/api/settings', (route) => route.fulfill({ json: languageSettings }))
        await page.goto('/decks/travel-vocabulary/', { waitUntil: 'domcontentloaded' })

        const labels = page.locator('[data-study-language]')
        const labelCount = await labels.count()
        expect(labelCount).toBeGreaterThan(0)

        for (const [code, name] of productionStudyLanguages) {
            await page.evaluate((nextCode) => localStorage.setItem('mainLang', nextCode), code)
            await page.reload({ waitUntil: 'domcontentloaded' })
            await expect(labels).toHaveText(Array(labelCount).fill(name))
        }

        const appCta = page.getByRole('link', { name: 'Open this pack in MemDecks' })
        await expect(appCta).toHaveAttribute('href', /view=library/)
        await expect(appCta).not.toHaveAttribute('href', /study=/)
    })

    test('selected-language copy follows app changes across tabs and browser history', async ({ page, context }) => {
        await context.route('**/api/settings', (route) => route.fulfill({ json: languageSettings }))
        await page.goto('/decks/travel-vocabulary/', { waitUntil: 'domcontentloaded' })
        await page.evaluate(() => localStorage.setItem('mainLang', 'fr'))
        await page.reload({ waitUntil: 'domcontentloaded' })

        const deckLabels = page.locator('[data-study-language]')
        await expect(deckLabels).toHaveText(Array(await deckLabels.count()).fill('French'))

        const appPage = await context.newPage()
        await appPage.goto('/?view=profile&study=ko', { waitUntil: 'domcontentloaded' })
        expect(await appPage.evaluate(() => localStorage.getItem('mainLang'))).toBe('ko')
        await expect(deckLabels).toHaveText(Array(await deckLabels.count()).fill('Korean'))

        await page.goto('/languages/', { waitUntil: 'domcontentloaded' })
        await expect(page.locator('[data-study-language]')).toHaveText('Korean')
        await page.evaluate(() => localStorage.setItem('mainLang', 'ar'))
        await page.goBack({ waitUntil: 'domcontentloaded' })
        await expect(page.locator('[data-study-language]')).toHaveText(
            Array(await page.locator('[data-study-language]').count()).fill('Arabic'),
        )
        await appPage.close()
    })

    test('sitemap contains only canonical pages that return 200', async ({ request }) => {
        const sitemap = await request.get('/sitemap.xml')
        expect(sitemap.status()).toBe(200)
        const body = await sitemap.text()
        const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
        expect(urls).toHaveLength(allIndexableRoutes.length)
        expect(body).not.toMatch(/\/admin|\/api\/|reset-password|[?#].*<\/loc>/)

        for (const url of urls) {
            const response = await request.get(new URL(url).pathname)
            expect(response.status(), url).toBe(200)
        }
    })

    test('clean support aliases redirect once to their canonical URL', async ({ request }) => {
        for (const route of ['/help', '/contact', '/privacy', '/terms', '/third-party-games']) {
            const response = await request.get(route, { maxRedirects: 0 })
            expect(response.status(), route).toBe(308)
            expect(response.headers().location).toBe(`${route}.html`)
        }
    })

    test('former language-coupled deck URLs redirect to neutral canonicals', async ({ request }) => {
        const aliases: Record<string, string> = {
            '/decks/starter-armenian/': '/decks/starter-vocabulary/',
            '/decks/greetings-armenian/': '/decks/greetings-vocabulary/',
            '/decks/travel-armenian/': '/decks/travel-vocabulary/',
            '/decks/food-armenian/': '/decks/food-vocabulary/',
            '/decks/family-armenian/': '/decks/family-vocabulary/',
        }
        for (const [route, canonical] of Object.entries(aliases)) {
            const response = await request.get(route, { maxRedirects: 0 })
            expect(response.status(), route).toBe(308)
            expect(response.headers().location).toBe(canonical)
        }
    })
})

test.describe('English content surface', () => {
    for (const route of contentRoutes) {
        test(`${route} is locale-tagged and attributed to one brand entity`, async ({ page }) => {
            await page.goto(route, { waitUntil: 'domcontentloaded' })

            const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
            expect(canonical).toBe(`https://memdecks.com${route}`)

            // Self-referencing hreflang: English is the only published locale, and
            // the pair has to be present so adding one is a content change.
            await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', canonical!)
            await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute('href', canonical!)

            // One Organization entity, spelled the same way on every page.
            const blocks = await page.locator('script[type="application/ld+json"]').allTextContents()
            const organization = blocks
                .map((block) => JSON.parse(block))
                .find((entry) => entry['@type'] === 'Organization')
            expect(organization, `${route} is missing Organization JSON-LD`).toBeTruthy()
            expect(organization.name).toBe('MemDecks')
            expect(organization['@id']).toBe('https://memdecks.com/#organization')
            expect(Array.isArray(organization.sameAs) && organization.sameAs.length).toBeTruthy()

            // Every content page states when its facts were last checked.
            await expect(page.locator('.doc-meta time')).toHaveCount(1)
        })
    }

    test('content pages do not overflow a mobile viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        for (const route of ['/en/docs/', '/en/docs/supported-languages/', '/en/pricing/', '/en/compare/anki/', '/en/blog/first-200-words/']) {
            await page.goto(route, { waitUntil: 'domcontentloaded' })
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
            }))
            expect(dimensions.content, `${route} has horizontal overflow`).toBeLessThanOrEqual(dimensions.viewport + 1)
        }
    })

    test('every glossary link in the docs resolves to a defined term', async ({ page, request }) => {
        await page.goto('/en/docs/glossary/', { waitUntil: 'domcontentloaded' })
        const definedIds = await page.locator('.doc-glossary__entry').evaluateAll(
            (nodes) => nodes.map((node) => node.id),
        )
        expect(definedIds.length).toBeGreaterThan(0)

        for (const route of ['/en/docs/what-is-memdecks/', '/en/docs/card-progress/', '/en/docs/decks-and-packs/', '/en/pricing/']) {
            const body = await (await request.get(route)).text()
            const anchors = [...body.matchAll(/href="\/en\/docs\/glossary\/#([^"]+)"/g)].map((match) => match[1])
            for (const anchor of anchors) {
                expect(definedIds, `${route} links to an undefined glossary term: ${anchor}`).toContain(anchor)
            }
        }
    })

    test('the blog feed lists the published posts', async ({ request }) => {
        const feed = await request.get('/en/blog/feed.xml')
        expect(feed.status()).toBe(200)
        const body = await feed.text()
        const items = [...body.matchAll(/<link>([^<]+)<\/link>/g)].map((match) => match[1])
        for (const route of contentRoutes.filter((entry) => entry.startsWith('/en/blog/') && entry !== '/en/blog/' && !entry.includes('/authors/'))) {
            expect(items, `${route} is missing from the feed`).toContain(`https://memdecks.com${route}`)
        }
    })
})
