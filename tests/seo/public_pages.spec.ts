import { expect, test, type Page } from '@playwright/test'

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

test.describe('one visual language', () => {
    // The seam #361 was about: a visitor crossing from a search result into the
    // app must not see the palette or the typeface change. Both halves read
    // tokens.css, so the check is that the tokens actually resolve the same.
    const TOKENS = [
        '--bg-base', '--bg-secondary', '--bg-panel', '--bg-panel-soft',
        '--text-strong', '--text-base', '--text-muted', '--text-soft',
        '--border', '--border-strong', '--ring',
        '--accent', '--accent-strong', '--accent-soft',
        '--action', '--action-line', '--action-shadow', '--mark',
        '--font-body', '--font-display', '--font-brand',
        '--shadow-sm', '--shadow-md', '--shadow-lg',
    ]

    async function readTokens(page: Page, route: string): Promise<Record<string, string>> {
        await page.goto(route, { waitUntil: 'domcontentloaded' })
        return page.evaluate((names: string[]) => {
            const style = getComputedStyle(document.documentElement)
            return Object.fromEntries(names.map((name: string) => [name, style.getPropertyValue(name).trim()]))
        }, TOKENS)
    }

    test('the app, the content pages and the legal pages resolve identical tokens', async ({ page }) => {
        const app = await readTokens(page, '/')
        for (const name of TOKENS) {
            expect(app[name], `the app does not define ${name}`).not.toBe('')
        }

        for (const route of ['/en/docs/', '/en/pricing/', '/decks/', '/languages/', '/contact.html', '/privacy.html']) {
            expect(await readTokens(page, route), `${route} does not share the app's tokens`).toEqual(app)
        }
    })

    test('every public surface stamps the same theme the app does', async ({ page }) => {
        for (const route of ['/', '/en/docs/', '/en/pricing/', '/decks/', '/contact.html']) {
            await page.goto(route, { waitUntil: 'domcontentloaded' })
            expect(await page.evaluate(() => document.documentElement.dataset.theme), route).toBe('light')
        }
    })

    test('content pages use the display serif for headings and the brand face for the wordmark', async ({ page }) => {
        await page.goto('/en/docs/card-progress/', { waitUntil: 'domcontentloaded' })
        const fonts = await page.evaluate(() => ({
            h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
            h2: getComputedStyle(document.querySelector('.doc-section h2')!).fontFamily,
            body: getComputedStyle(document.body).fontFamily,
            brand: getComputedStyle(document.querySelector('.seo-brand')!).fontFamily,
            display: getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim(),
            bodyToken: getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim(),
            brandToken: getComputedStyle(document.documentElement).getPropertyValue('--font-brand').trim(),
        }))
        // Computed font-family drops the quotes around single-word families, so
        // compare the stacks rather than the strings.
        const families = (stack: string) => stack.split(',').map((name) => name.trim().replace(/^["']|["']$/g, ''))

        expect(families(fonts.h1)).toEqual(families(fonts.display))
        expect(families(fonts.h2)).toEqual(families(fonts.display))
        expect(families(fonts.body)).toEqual(families(fonts.bodyToken))
        expect(families(fonts.brand)).toEqual(families(fonts.brandToken))
    })

    test('small labels on public pages clear AA against the page ground', async ({ page }) => {
        // --text-soft measures 3.76:1 on the parchment ground; eyebrows and table
        // headers are ~12px, so they need 4.5:1 and must use --text-muted.
        for (const route of ['/en/docs/supported-languages/', '/en/pricing/', '/decks/travel-vocabulary/', '/languages/']) {
            await page.goto(route, { waitUntil: 'domcontentloaded' })
            const failures = await page.evaluate(() => {
                const luminance = (colour: string) => {
                    const [r, g, b] = (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number).map((value: number) => {
                        const channel = value / 255
                        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
                    })
                    return 0.2126 * r + 0.7152 * g + 0.0722 * b
                }
                const contrast = (foreground: string, background: string) => {
                    const a = luminance(foreground)
                    const b = luminance(background)
                    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
                }
                // The page paints its ground with gradients, so sample the token.
                const ground = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim()
                const probe = document.createElement('span')
                probe.style.color = ground
                document.body.appendChild(probe)
                const groundRgb = getComputedStyle(probe).color
                probe.remove()

                const selectors = [
                    '.seo-eyebrow', '.seo-kicker', '.seo-card__meta', '.seo-facts dt',
                    '.doc-breadcrumbs ol', '.doc-meta', '.doc-toc__title',
                    '.doc-table caption', '.doc-table thead th', '.doc-note', '.doc-related__title',
                ]
                const bad = []
                for (const selector of selectors) {
                    const element = document.querySelector(selector)
                    if (!element) continue
                    const ratio = contrast(getComputedStyle(element).color, groundRgb)
                    if (ratio < 4.5) bad.push(`${selector} = ${ratio.toFixed(2)}`)
                }
                return bad
            })
            expect(failures, route).toEqual([])
        }
    })
})

test.describe('glossary hover preview', () => {
    const PAGE = '/en/docs/word-cards/'

    test('a glossary link previews its definition on hover, and it matches the glossary', async ({ page }) => {
        await page.goto('/en/docs/glossary/', { waitUntil: 'domcontentloaded' })
        const definition = (await page.locator('#card-hp dd').innerText()).replace(/\s+/g, ' ').trim()

        await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
        const preview = page.locator('#doc-term-preview')
        await expect(preview).toBeHidden()

        await page.locator('[data-term="card-hp"]').first().hover()
        await expect(preview).toBeVisible()
        await expect(preview.locator('strong')).toHaveText('Card HP')

        // The preview is the glossary text, not a second definition someone
        // wrote for the tooltip. If these drift, the term has two meanings.
        const shown = (await preview.locator('span').innerText()).replace(/\s+/g, ' ').trim()
        expect(definition).toContain(shown.slice(0, 80))
    })

    test('the preview stays on screen and never covers the link', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
        const preview = page.locator('#doc-term-preview')

        for (const term of ['transliteration', 'tts', 'score', 'collection']) {
            const link = page.locator(`[data-term="${term}"]`).first()
            await link.scrollIntoViewIfNeeded()
            await link.hover()
            // Wait for the preview to be about *this* link, not the previous one.
            await expect(link).toHaveAttribute('aria-describedby', 'doc-term-preview')
            await expect(preview).toBeVisible()

            const box = (await preview.boundingBox())!
            const anchor = (await link.boundingBox())!
            const viewport = page.viewportSize()!
            expect(box.x, `${term}: preview off the left edge`).toBeGreaterThanOrEqual(0)
            expect(box.y, `${term}: preview off the top edge`).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width, `${term}: preview off the right edge`).toBeLessThanOrEqual(viewport.width + 1)
            expect(box.y + box.height, `${term}: preview off the bottom edge`).toBeLessThanOrEqual(viewport.height + 1)
            const overlaps = box.y < anchor.y + anchor.height && box.y + box.height > anchor.y
            expect(overlaps, `${term}: preview covers the link it describes`).toBe(false)
        }
    })

    test('keyboard focus previews too, and Escape dismisses it', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
        const preview = page.locator('#doc-term-preview')
        const link = page.locator('[data-term]').first()

        await link.focus()
        await expect(preview).toBeVisible()
        await expect(link).toHaveAttribute('aria-describedby', 'doc-term-preview')

        await page.keyboard.press('Escape')
        await expect(preview).toBeHidden()
        expect(await link.getAttribute('aria-describedby')).toBeNull()
    })

    test('scrolling dismisses the preview rather than stranding it', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
        const preview = page.locator('#doc-term-preview')
        const link = page.locator('[data-term]').first()
        await link.scrollIntoViewIfNeeded()
        await link.hover()
        await expect(preview).toBeVisible()

        await page.mouse.wheel(0, 200)
        await expect(preview).toBeHidden()
    })

    test('the preview never intercepts a click on the link', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
        const link = page.locator('[data-term="card-hp"]').first()
        await link.scrollIntoViewIfNeeded()
        await link.hover()
        await expect(page.locator('#doc-term-preview')).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(/\/en\/docs\/glossary\/#card-hp$/)
    })

    test('the payload carries only the terms the page links, and every one resolves', async ({ page }) => {
        for (const route of ['/en/docs/word-cards/', '/en/docs/where-words-come-from/', '/en/pricing/']) {
            await page.goto(route, { waitUntil: 'domcontentloaded' })
            const { linked, shipped } = await page.evaluate(() => ({
                linked: [...new Set([...document.querySelectorAll('[data-term]')].map((node) => (node as HTMLElement).dataset.term))],
                shipped: Object.keys(JSON.parse(document.getElementById('glossary-previews')!.textContent!)),
            }))
            expect(linked.length, `${route} has no glossary links`).toBeGreaterThan(0)
            expect(shipped.sort(), route).toEqual([...linked].sort())
        }
    })

    test('the definitions are not rendered into the page text', async ({ page, request }) => {
        // The glossary is the one canonical home for a definition. Shipping the
        // preview as JSON keeps twenty near-duplicate chunks out of the corpus.
        const body = await (await request.get(PAGE)).text()
        const visible = body.replace(/<script[\s\S]*?<\/script>/gi, '')
        expect(visible).not.toContain('The amount of practice a specific card needs')
        expect(body).toContain('The amount of practice a specific card needs')
        expect(await page.goto(PAGE).then(() => page.locator('body').innerText()))
            .not.toContain('The amount of practice a specific card needs')
    })

    test('a touch device gets the link, not a tooltip', async ({ browser }) => {
        const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } })
        const page = await context.newPage()
        await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
        // No hover on touch, so the script must not build the bubble at all.
        expect(await page.locator('#doc-term-preview').count()).toBe(0)
        await expect(page.locator('[data-term]').first()).toHaveAttribute('href', /\/en\/docs\/glossary\/#/)
        await context.close()
    })
})

test.describe('the docs tell the truth about the language set', () => {
    // The build can check the docs against the language *registry*, but not
    // against ENABLED_LANGUAGES — that is deployment config, and only a live
    // environment knows it. This is the check that catches "we turned a
    // language on (or off) and the documentation still says sixteen".
    test('the supported-languages page matches what this environment actually serves', async ({ page, request }) => {
        const settings = await (await request.get('/api/settings')).json()
        const served: string[] = (settings.enabledLanguages ?? []).filter((code: string) => code !== 'en')
        expect(served.length, 'the environment reports no study languages').toBeGreaterThan(0)

        await page.goto('/en/docs/supported-languages/', { waitUntil: 'domcontentloaded' })
        const documented = await page.locator('.doc-table tbody th').allInnerTexts()

        expect(documented.length, 'the page lists a different number of languages than the app serves')
            .toBe(served.length)

        // The page states the count in prose too, and prose is what gets quoted.
        const intro = await page.locator('.doc-hero__intro').innerText()
        expect(intro, 'the intro states a count that does not match the table')
            .toContain(String(served.length))

        // Same list, by English name, in both directions.
        const namesInApp = new Map<string, string>(
            (settings.languages ?? []).map((entry: { code: string, englishName: string }) => [entry.code, entry.englishName]),
        )
        for (const code of served) {
            const name = namesInApp.get(code)
            if (!name) continue // built-in languages are not streamed as descriptors
            expect(documented, `the app serves ${name} (${code}) but the docs do not list it`).toContain(name)
        }
    })

    // Prose spells small numbers out, so the assertion has to accept either form.
    const NUMBER_WORDS = [
        'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
        'nineteen', 'twenty',
    ]
    const spell = (value: number) => NUMBER_WORDS[value] ?? String(value)

    test('the roster is stated identically wherever the docs repeat it', async ({ page }) => {
        await page.goto('/en/docs/supported-languages/', { waitUntil: 'domcontentloaded' })
        const table = await page.locator('.doc-table tbody th').allInnerTexts()
        const count = table.length

        for (const [route, selector] of [
            ['/en/docs/', '#getting-started'],
            ['/en/docs/what-is-memdecks/', '.doc-hero__intro'],
            ['/en/docs/faq/', '#q4 p'],
            ['/en/about/', '.doc-table'],
        ] as const) {
            await page.goto(route, { waitUntil: 'domcontentloaded' })
            const text = (await page.locator(selector).first().innerText()).toLowerCase()
            const stated = text.includes(String(count)) || text.includes(spell(count))
            expect(stated, `${route} does not state the language count as ${count}`).toBe(true)
        }
    })
})
