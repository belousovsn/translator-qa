import { expect, test, type Route } from '@playwright/test'
import { LibraryPage } from '../../page_objects/library-page.js'
import { buildNewFormatAnkiPackage, buildRealAnkiPackage } from '../fixtures/ankiPackage.js'

const IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function item(guid: string, sourceWord: string, targetWord: string, deckName: string, result: 'imported' | 'duplicate' = 'imported') {
    return {
        guid,
        result,
        cardKey: sourceWord.toLowerCase(),
        sourceWord,
        targetWord,
        deckName,
        wordId: null,
        sourceHash: `hash-${guid}`,
        imageFile: sourceWord === 'Hund' ? 'dog.png' : sourceWord === 'Vogel' ? 'bad.svg' : null,
        audioFile: sourceWord === 'Hund' ? 'hund.mp3' : null,
        transliteration: null,
        ttsFile: '',
        skipReason: null,
    }
}

function skippedItem() {
    return {
        ...item('real-sentence', 'Wie geht es dir heute?', '', 'German'),
        result: 'skipped' as const,
        cardKey: '',
        skipReason: 'looks like a sentence rather than a vocabulary item',
    }
}

function basicFieldMapping() {
    return {
        noteTypeId: '1',
        noteTypeName: 'Basic',
        sourceFieldOrd: 0,
        targetFieldOrd: 1,
        imageFieldOrd: 2,
        audioFieldOrd: 0,
        transliterationFieldOrd: null,
        confidence: 'medium',
        inferred: true,
        explanation: 'Selected from the consistently populated text fields; verify the example.',
        exampleSource: 'Hund',
        exampleTarget: 'dog',
        fields: [
            { ord: 0, name: 'Front', sample: 'Hund', textFillRate: 1, imageFillRate: 0, audioFillRate: 0.33 },
            { ord: 1, name: 'Back', sample: 'dog', textFillRate: 1, imageFillRate: 0, audioFillRate: 0 },
            { ord: 2, name: 'Image', sample: '', textFillRate: 0, imageFillRate: 0.67, audioFillRate: 0 },
        ],
    }
}

test('previews subsets, commits, renders private media, and explains a duplicate re-import', async ({ page }) => {
    let committed = false
    let previewRequests = 0
    let commitRequests = 0
    const selectedImages = new Map<string, { small: string, large: string }>()
    const uploadedImages = new Set<string>()
    const collectionKeys = new Set<string>()

    const preparation = () => {
        const readyCardKeys = ['hund', ...selectedImages.keys(), ...uploadedImages]
        return {
            status: collectionKeys.size === 3
                ? 'in_collection'
                : collectionKeys.size > 0
                    ? 'partially_added'
                    : readyCardKeys.length === 3 ? 'ready' : 'needs_setup',
            total: 3,
            ready: readyCardKeys.length,
            missingImage: 3 - readyCardKeys.length,
            missingTarget: 0,
            missingSource: 0,
            missingAudio: 0,
            missingTransliteration: 0,
            inCollection: collectionKeys.size,
            missingLanguage: false,
            readyCardKeys,
        }
    }

    await page.route('**/api/library/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/library/initialize') {
            await route.fulfill({ json: { ok: true, autoSubscribed: [] } })
            return
        }
        if (path === '/api/library/starter-decks') {
            await route.fulfill({ json: [] })
            return
        }
        if (path === '/api/library/packs') {
            await route.fulfill({ json: [] })
            return
        }
        await route.fallback()
    })

    await page.route('**/api/decks**', async (route: Route) => {
        const request = route.request()
        const url = new URL(request.url())
        const path = url.pathname

        if (path === '/api/decks' && request.method() === 'GET') {
            await route.fulfill({ json: committed ? [{
                id: 'deck-1',
                title: 'Travel words',
                description: 'Imported from Anki (German, Spanish)',
                source_lang: 'en',
                target_lang: 'hy',
                visibility: 'private',
                origin: 'import',
                updated_at: '2026-08-09T00:00:00Z',
                preparation: preparation(),
            }] : [] })
            return
        }

        if (path === '/api/decks/import/anki/preview') {
            previewRequests += 1
            expect(request.method()).toBe('POST')
            expect(request.headers()['content-type']).toBe('application/octet-stream')
            expect(request.postDataBuffer()?.subarray(0, 2).toString()).toBe('PK')

            const selected = url.searchParams.get('deckNames')
            const subset = selected === 'Spanish'
            const duplicate = committed
            const reviewedMappings = JSON.parse(url.searchParams.get('fieldMappings') ?? '[]') as Array<{
                noteTypeId: string
                sourceFieldOrd: number
                targetFieldOrd: number
                imageFieldOrd: number | null
                audioFieldOrd: number | null
            }>
            const sample = subset
                ? [item('real-katze', 'Katze', 'cat', 'Spanish', duplicate ? 'duplicate' : 'imported')]
                : [
                    item('real-hund', 'Hund', 'dog', 'German', duplicate ? 'duplicate' : 'imported'),
                    item('real-katze', 'Katze', 'cat', 'Spanish', duplicate ? 'duplicate' : 'imported'),
                    item('real-vogel', 'Vogel', 'bird', 'German', duplicate ? 'duplicate' : 'imported'),
                ]
            await route.fulfill({ json: {
                collectionId: 'collection-1',
                deckNames: ['German', 'Spanish'],
                counts: {
                    imported: duplicate ? 0 : sample.length,
                    updated: 0,
                    duplicate: duplicate ? sample.length : 0,
                    skipped: subset ? 0 : 1,
                },
                unresolvedWordCount: sample.length,
                summary: duplicate
                    ? `${sample.length} already imported${subset ? '' : ', 1 skipped'}`
                    : `${sample.length} to import${subset ? '' : ', 1 skipped'}`,
                sample,
                skipped: subset ? [] : [skippedItem()],
                noteTypeMappings: reviewedMappings.length > 0
                    ? [{
                        ...basicFieldMapping(),
                        ...reviewedMappings[0],
                        confidence: 'manual',
                        inferred: false,
                        explanation: 'Using the field mapping you selected.',
                    }]
                    : [basicFieldMapping()],
                learningLanguageScan: {
                    sourceLang: 'en',
                    targetLang: 'hy',
                    candidateCount: sample.length,
                    matchingCount: 0,
                    mismatchingCount: sample.length,
                    examples: sample.map((entry) => entry.targetWord),
                    validation: 'script_match',
                },
                coverage: {
                    total: sample.length,
                    components: [
                        { component: 'learning_word', label: 'Learning word', required: true, fromAnki: sample.length, memdecksWillAdd: 0, userMustAdd: 0, remainingMissing: 0, note: 'Confirmed anchor.' },
                        { component: 'initial_meaning', label: 'Initial-language meaning', required: true, fromAnki: sample.length, memdecksWillAdd: 0, userMustAdd: 0, remainingMissing: 0, note: 'Kept from Anki.' },
                        { component: 'sound', label: 'Sound', required: true, fromAnki: 1, memdecksWillAdd: sample.length - 1, userMustAdd: 0, remainingMissing: 0, note: 'Memdecks TTS.' },
                        { component: 'picture', label: 'Picture', required: true, fromAnki: 1, memdecksWillAdd: 0, userMustAdd: sample.length - 1, remainingMissing: sample.length - 1, note: 'You choose.' },
                        { component: 'transliteration', label: 'Transliteration', required: true, fromAnki: 0, memdecksWillAdd: sample.length, userMustAdd: 0, remainingMissing: 0, note: 'Memdecks fills.' },
                    ],
                },
            } })
            return
        }

        if (path === '/api/decks/import/anki/commit') {
            commitRequests += 1
            expect(request.postDataBuffer()?.subarray(0, 2).toString()).toBe('PK')
            expect(url.searchParams.get('sourceLang')).toBe('en')
            expect(url.searchParams.get('targetLang')).toBe('hy')
            expect(url.searchParams.get('learningWordsConfirmed')).toBe('true')
            const duplicate = committed
            const mappings = JSON.parse(url.searchParams.get('fieldMappings') ?? '[]') as Array<{
                sourceFieldOrd: number, targetFieldOrd: number
            }>
            expect(mappings[0]).toMatchObject(duplicate
                ? { sourceFieldOrd: 0, targetFieldOrd: 1 }
                : { sourceFieldOrd: 1, targetFieldOrd: 0 })
            committed = true
            await route.fulfill({ status: 201, json: {
                deckId: 'deck-1',
                title: 'Travel words',
                sourceLang: 'en',
                targetLang: 'hy',
                jobId: `job-${commitRequests}`,
                collectionId: 'collection-1',
                counts: { imported: duplicate ? 0 : 3, updated: 0, duplicate: duplicate ? 3 : 0, skipped: 1 },
                unresolvedWordCount: 3,
                summary: duplicate ? '3 already imported, 1 skipped' : '3 to import, 1 skipped',
                media: {
                    stored: duplicate ? 0 : 2,
                    rejected: duplicate ? [] : [{ originalName: 'bad.svg', reason: 'file type not recognised as an image or audio file' }],
                },
            } })
            return
        }

        if (path === '/api/decks/deck-1') {
            await route.fulfill({ json: {
                deck: {
                    id: 'deck-1', title: 'Travel words', description: 'Imported from Anki (German, Spanish)',
                    source_lang: 'en', target_lang: 'hy', visibility: 'private', origin: 'import', rights_confirmed_at: null,
                    updated_at: '2026-08-09T00:00:00Z',
                },
                cards: [
                    { card_key: 'hund', lemma: 'hund', pos: '', word_id: null, target_word: 'dog', transliteration: 'dog', ttsfile: null, img_url_small: null, img_url_large: null, image_media_id: 'image-1', audio_media_id: 'audio-1', collection_ready: true, collection_card_id: collectionKeys.has('hund') ? 'card-hund' : null, in_collection: collectionKeys.has('hund'), sort_order: 0 },
                    { card_key: 'katze', lemma: 'katze', pos: '', word_id: null, target_word: 'cat', transliteration: 'cat', ttsfile: 'hy/cat.mp3', img_url_small: selectedImages.get('katze')?.small ?? null, img_url_large: selectedImages.get('katze')?.large ?? null, image_media_id: null, audio_media_id: null, collection_ready: selectedImages.has('katze'), collection_card_id: collectionKeys.has('katze') ? 'card-katze' : null, in_collection: collectionKeys.has('katze'), sort_order: 1 },
                    { card_key: 'vogel', lemma: 'vogel', pos: '', word_id: null, target_word: 'bird', transliteration: 'bird', ttsfile: 'hy/bird.mp3', img_url_small: selectedImages.get('vogel')?.small ?? null, img_url_large: selectedImages.get('vogel')?.large ?? null, image_media_id: uploadedImages.has('vogel') ? 'uploaded-vogel' : null, audio_media_id: null, collection_ready: uploadedImages.has('vogel'), collection_card_id: collectionKeys.has('vogel') ? 'card-vogel' : null, in_collection: collectionKeys.has('vogel'), sort_order: 2 },
                ],
                preparation: preparation(),
                publishedRevision: null,
            } })
            return
        }

        if (path === '/api/decks/deck-1/languages' && request.method() === 'PATCH') {
            expect(request.postDataJSON()).toEqual({ sourceLang: 'en', targetLang: 'hy' })
            await route.fulfill({ json: { id: 'deck-1', source_lang: 'en', target_lang: 'hy' } })
            return
        }

        const imageMatch = path.match(/^\/api\/decks\/deck-1\/cards\/([^/]+)\/image$/)
        if (imageMatch && request.method() === 'PATCH') {
            const cardKey = decodeURIComponent(imageMatch[1] ?? '')
            const body = request.postDataJSON() as { imageUrlSmall: string, imageUrlLarge: string }
            selectedImages.set(cardKey, { small: body.imageUrlSmall, large: body.imageUrlLarge })
            await route.fulfill({ json: {
                card_key: cardKey,
                img_url_small: body.imageUrlSmall,
                img_url_large: body.imageUrlLarge,
                image_media_id: null,
            } })
            return
        }

        const uploadMatch = path.match(/^\/api\/decks\/deck-1\/cards\/([^/]+)\/image-upload$/)
        if (uploadMatch && request.method() === 'POST') {
            const cardKey = decodeURIComponent(uploadMatch[1] ?? '')
            expect(request.headers()['content-type']).toBe('image/png')
            expect(request.postDataBuffer()?.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
            uploadedImages.add(cardKey)
            await route.fulfill({ json: {
                card_key: cardKey,
                img_url_small: null,
                img_url_large: null,
                image_media_id: `uploaded-${cardKey}`,
            } })
            return
        }

        if (path === '/api/decks/deck-1/collection' && request.method() === 'POST') {
            const before = collectionKeys.size
            for (const cardKey of preparation().readyCardKeys) collectionKeys.add(cardKey)
            const linked = collectionKeys.size - before
            await route.fulfill({ json: {
                added: linked,
                reused: 0,
                linked,
                preparation: preparation(),
            } })
            return
        }

        if (path === '/api/decks/media/image-1/url') {
            await route.fulfill({ json: { mediaId: 'image-1', mimeType: 'image/png', role: 'source_image', url: IMAGE_DATA_URL } })
            return
        }

        if (path === '/api/decks/media/audio-1/url') {
            await route.fulfill({ json: { mediaId: 'audio-1', mimeType: 'audio/mpeg', role: 'target_audio', url: 'data:audio/mpeg;base64,SUQz' } })
            return
        }


        if (path === '/api/decks/media/uploaded-vogel/url') {
            await route.fulfill({ json: { mediaId: 'uploaded-vogel', mimeType: 'image/png', role: 'source_image', url: IMAGE_DATA_URL } })
            return
        }

        await route.fallback()
    })

    await page.route('**/api/images?**', async (route) => {
        expect(new URL(route.request().url()).searchParams.get('query')).toBe('katze')
        await route.fulfill({ json: [{
            id: 'cat-image',
            urlSmall: 'https://images.test/cat-small.webp',
            urlLarge: 'https://images.test/cat-large.webp',
            wordValue: 'katze',
            description: 'A cat',
        }] })
    })

    const library = new LibraryPage(page)
    const packageBytes = buildRealAnkiPackage(1770000001)
    await library.goto()
    await library.openAnkiImport()
    await library.uploadPackage(packageBytes)

    await expect(page.locator('#ankiLearningConfirm')).toBeVisible()
    await expect(page.locator('.anki-learning-examples')).toContainText('dog')
    await expect(page.locator('#ankiImportSourceLang')).toHaveValue('en')
    await expect(page.locator('#ankiImportTargetLang')).toHaveValue('hy')
    await expect(page.locator('.anki-field-mapping')).toContainText('Basic')

    // A custom deck can reverse the inferred direction without changing every note.
    await page.locator('details.anki-field-mappings > summary').click()
    await page.locator('.anki-field-mapping summary').click()
    await page.locator('[data-anki-mapping-source]').selectOption('1')
    await page.locator('[data-anki-mapping-target]').selectOption('0')
    await expect(page.locator('.anki-field-mapping__confidence')).toHaveText('Your selection')

    await page.getByRole('checkbox', { name: 'German' }).uncheck()
    await expect(page.locator('.anki-learning-examples li')).toHaveCount(1)
    expect(new URL(page.url()).pathname).toBe('/index.html')
    await page.getByRole('checkbox', { name: 'German' }).check()
    await expect(page.locator('.anki-learning-examples li')).toHaveCount(3)
    await page.locator('#ankiLearningConfirm').click()
    await expect(page.locator('.anki-import-count--new strong')).toHaveText('3')
    await expect(page.locator('.anki-import-skipped')).toContainText('looks like a sentence')
    await expect(page.locator('.anki-import-info')).toContainText('catalog-unmatched')
    await expect(page.locator('.anki-component-coverage')).toContainText('Memdecks adds')

    await page.locator('#ankiImportDeckTitle').fill('Travel words')
    await page.locator('#ankiImportCommit').click()
    await expect(page.locator('.anki-import-success')).toContainText('Travel words')
    await expect(page.locator('.anki-import-skipped')).toContainText('bad.svg')
    await expect(page.locator('.anki-import-skipped')).toContainText('Cards were still imported')
    await expect(page.locator('#libraryDraftDecksGrid .library-owned-deck-card')).toContainText('1 of 3 ready')
    await expect(page.locator('#libraryDraftDecksGrid .library-owned-deck-card')).toContainText('Missing 2 pictures')

    await page.locator('[data-anki-view-deck]').click()
    await expect(page.locator('.anki-owned-card')).toHaveCount(3)
    await expect(page.locator('.anki-owned-card').first().locator('img')).toBeVisible()
    await expect(page.locator('.anki-owned-card').last()).toContainText('bird')
    await expect(page.locator('.anki-owned-deck-status')).toHaveText('Draft')
    await expect(page.locator('.anki-preparation-summary')).toContainText('1 of 3 cards ready')
    await expect(page.locator('[data-anki-add-collection]')).toHaveText('Add 1 ready card to Collection')

    await page.locator('[data-anki-add-collection]').click()
    await expect(page.locator('.anki-owned-deck-status')).toHaveText('Partially added')
    await expect(page.locator('.anki-preparation-summary')).toContainText('1 already in Collection')

    await page.locator('.anki-owned-card').filter({ hasText: 'cat' }).locator('[data-anki-find-image]').click()
    await page.locator('[data-anki-image-choice="katze"]').click()
    await expect(page.locator('.anki-preparation-summary')).toContainText('2 of 3 cards ready')
    await expect(page.locator('[data-anki-add-collection]')).toHaveText('Add 1 ready card to Collection')
    await page.locator('[data-anki-add-collection]').click()
    await expect(page.locator('.anki-preparation-summary')).toContainText('2 already in Collection')

    await page.locator('[data-anki-upload-image="vogel"]').setInputFiles({
        name: 'bird.png',
        mimeType: 'image/png',
        buffer: Buffer.from(IMAGE_DATA_URL.split(',')[1] ?? '', 'base64'),
    })
    await expect(page.locator('.anki-preparation-summary')).toContainText('3 of 3 cards ready')
    await page.locator('[data-anki-add-collection]').click()
    await expect(page.locator('.anki-owned-deck-status')).toHaveText('In Collection')
    await page.locator('[data-anki-done]').click()

    await expect(page.locator('#libraryOwnedDecksSection')).toBeVisible()
    await expect(page.locator('#libraryDraftDecksGrid')).toContainText('No drafts')
    await expect(page.locator('#libraryPersonalDecksGrid .library-owned-deck-card')).toContainText('Travel words')
    await expect(page.locator('#libraryPersonalDecksGrid .library-owned-deck-card')).toContainText('3 cards')
    await expect(page.locator('#libraryPersonalDecksGrid .library-owned-deck-card')).toContainText('All 3 cards are in Collection')
    await library.openAnkiImport()
    await library.uploadPackage(packageBytes)
    await page.locator('#ankiLearningConfirm').click()
    await expect(page.locator('.anki-import-count--duplicate strong')).toHaveText('3')
    await expect(page.locator('.anki-import-info--duplicate')).toContainText('expected, not a failure')
    await page.locator('#ankiImportCommit').click()
    await expect(page.locator('.anki-import-info--duplicate')).toContainText('no duplicate cards were created')

    expect(previewRequests).toBeGreaterThanOrEqual(4)
    expect(commitRequests).toBe(2)
})

test('surfaces the newer-format re-export instruction verbatim', async ({ page }) => {
    const instruction = 'This package uses Anki’s newer compressed format. Re-export it with “Support older Anki versions” enabled.'
    await page.route('**/api/library/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/library/initialize') return route.fulfill({ json: { ok: true, autoSubscribed: [] } })
        if (path === '/api/library/starter-decks' || path === '/api/library/packs') return route.fulfill({ json: [] })
        return route.fallback()
    })
    await page.route('**/api/decks**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/decks' && route.request().method() === 'GET') return route.fulfill({ json: [] })
        if (path === '/api/decks/import/anki/preview') return route.fulfill({ status: 400, json: { error: instruction } })
        return route.fallback()
    })

    const library = new LibraryPage(page)
    await library.goto()
    await library.openAnkiImport()
    await library.uploadPackage(buildNewFormatAnkiPackage(), 'new-format.apkg')

    await expect(page.locator('#ankiImportError')).toHaveText(instruction)
})
