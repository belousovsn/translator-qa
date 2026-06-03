import { test, expect, type Page } from '@playwright/test'
import { TranslatorPage } from '../../page_objects/translator-page.js'
import { catUnsplashMock } from '../mocks/imageMocks.js'

function translationFor(word: string) {
    return {
        id: `mock-${word}`,
        wordId: word === 'sheep' ? 101 : 102,
        englishWord: { id: `en-${word}`, value: word, language: 'en' },
        foreignWord: { id: `hy-${word}`, value: word === 'sheep' ? 'ոչխար' : 'շուն', language: 'hy' },
        transliteration: word === 'sheep' ? 'vochkhar' : 'shun',
        ttsFile: '',
    }
}

function pumpStatus(savedLemmaCount: number, totalLemmaCount: number) {
    return {
        subscribedPackCount: totalLemmaCount > 0 ? 1 : 0,
        savedLemmaCount,
        totalLemmaCount,
        queueDepth: Math.max(0, totalLemmaCount - savedLemmaCount),
        queueDirty: false,
        buildStatus: 'ready',
    }
}

async function mockLearningInitialize(page: Page) {
    await page.route('**/api/library/initialize', route =>
        route.fulfill({ status: 200, body: JSON.stringify({ ok: true, autoSubscribed: [], queueDirty: false }) }),
    )
}

test('pump next translates words and implicit next records skip', async ({ page }) => {
    const translatorPage = new TranslatorPage(page)
    const pumpWords = [
        { done: false, lemmaId: 1, englishLemma: 'sheep', position: 1, totalRemaining: 2 },
        { done: false, lemmaId: 2, englishLemma: 'dog', position: 2, totalRemaining: 2 },
    ]

    await mockLearningInitialize(page)
    await page.route('**/api/pump/status**', route => {
        route.fulfill({ status: 200, body: JSON.stringify(pumpStatus(0, 2)) })
    })
    await page.route('**/api/pump/next**', route => {
        route.fulfill({ status: 200, body: JSON.stringify(pumpWords.shift() ?? { done: true, totalRemaining: 0 }) })
    })
    await page.route('**/api/pump/skip', route => {
        route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
    })
    await page.route('**/api/translate', route => {
        const body = route.request().postDataJSON() as { word: string }
        route.fulfill({ status: 200, body: JSON.stringify(translationFor(body.word)) })
    })
    await page.route('**/api/images**', route =>
        route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) }),
    )

    await translatorPage.goto()
    await expect(translatorPage.inputField).toHaveValue('')
    await expect(translatorPage.translatedWord).toBeEmpty()
    await expect(translatorPage.pumpBarPosition).toHaveText('0')
    await expect(translatorPage.pumpBarTotal).toHaveText('2')

    await translatorPage.clickNextWord()
    await expect(translatorPage.inputField).toHaveValue('sheep')
    await expect(translatorPage.sourceLangLabel).toHaveText('English')
    await expect(translatorPage.targetLangLabel).toHaveText('Armenian')
    await expect(translatorPage.translatedWord).toHaveText('ոչխար')
    await expect(translatorPage.pumpBarPosition).toHaveText('0')
    await expect(translatorPage.pumpBarTotal).toHaveText('2')

    const skipRequest = page.waitForRequest('**/api/pump/skip')
    await translatorPage.clickNextWord()
    const skipBody = (await skipRequest).postDataJSON() as { lemmaId: number }
    expect(skipBody.lemmaId).toBe(1)
    await expect(translatorPage.inputField).toHaveValue('dog')
    await expect(translatorPage.translatedWord).toHaveText('շուն')
})

test('pump done state points learners to the library', async ({ page }) => {
    const translatorPage = new TranslatorPage(page)

    await mockLearningInitialize(page)
    await page.route('**/api/pump/status**', route =>
        route.fulfill({ status: 200, body: JSON.stringify(pumpStatus(0, 0)) }),
    )
    await page.route('**/api/pump/next**', route =>
        route.fulfill({ status: 200, body: JSON.stringify({ done: true, totalRemaining: 0 }) }),
    )
    await page.route('**/api/translate', route =>
        route.fulfill({ status: 200, body: JSON.stringify(translationFor('dog')) }),
    )

    await translatorPage.goto()
    await expect(translatorPage.pumpDoneMessage).toBeVisible()
    await expect(translatorPage.pumpDoneMessage).toContainText('All caught up')
    await expect(translatorPage.pumpBarProgressText).toBeHidden()
    await expect(translatorPage.pumpBarDoneIcon).toBeVisible()
    await expect(translatorPage.nextWordButton).toContainText('Get more words')

    await translatorPage.clickNextWord()
    await expect(page.locator('#libraryPage')).not.toHaveClass(/hidden/)
})

test('pump progress shows durable unlocked topic progress across save and reload', async ({ page }) => {
    const translatorPage = new TranslatorPage(page)
    let saved = false

    await mockLearningInitialize(page)
    await page.route('**/api/pump/status**', route => {
        route.fulfill({ status: 200, body: JSON.stringify(pumpStatus(saved ? 34 : 33, 200)) })
    })
    await page.route('**/api/pump/next**', route => {
        route.fulfill({
            status: 200,
            body: JSON.stringify({ done: false, lemmaId: 1, englishLemma: 'sheep', position: 1, totalRemaining: 167 }),
        })
    })
    await page.route('**/api/translate', route => {
        const body = route.request().postDataJSON() as { word: string }
        route.fulfill({ status: 200, body: JSON.stringify(translationFor(body.word)) })
    })
    await page.route('**/api/images**', route =>
        route.fulfill({ status: 200, body: JSON.stringify(catUnsplashMock) }),
    )
    await page.route('**/api/cards/save', route => {
        saved = true
        route.fulfill({ status: 200, body: JSON.stringify({ message: 'saved' }) })
    })

    await translatorPage.goto()
    await expect(translatorPage.pumpBarPosition).toHaveText('33')
    await expect(translatorPage.pumpBarTotal).toHaveText('200')

    await translatorPage.clickNextWord()
    await expect(translatorPage.translatedWord).toHaveText('ոչխար')
    await translatorPage.openSaveModal()
    await translatorPage.saveModalConfirmButton.click()
    await expect(translatorPage.pumpBarPosition).toHaveText('34')
    await expect(translatorPage.pumpBarTotal).toHaveText('200')

    await page.reload({ waitUntil: 'networkidle' })
    await expect(translatorPage.pumpBarPosition).toHaveText('34')
    await expect(translatorPage.pumpBarTotal).toHaveText('200')
    await expect(translatorPage.inputField).toHaveValue('')
})
