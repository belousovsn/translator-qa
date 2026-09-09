import type { Translation, WordEnrichment } from '../../src/types.js'

// Armenian → English: "կատու" → "cat"
export const catTranslationMockHy: Translation = {
    id: 'mock-id-cat-hy',
    wordId: 999001,
    englishWord: { id: 'mock-en-cat', value: 'cat', language: 'en' },
    foreignWord: { id: 'mock-hy-cat', value: 'կատու', language: 'hy' },
    transliteration: 'katu',
    ttsFile: '',
}

// English → Armenian: "dog" → "շուն"
export const dogTranslationMockHy: Translation = {
    id: 'mock-id-hy',
    englishWord: { id: 'mock-en-1', value: 'dog', language: 'en' },
    foreignWord: { id: 'mock-hy-1', value: 'շուն', language: 'hy' },
    transliteration: 'shun',
    ttsFile: '',
}

// English → Armenian with TTS file (word exists in collection)
export const dogTranslationMockHyWithTts: Translation = {
    id: 'mock-id-hy-tts',
    englishWord: { id: 'mock-en-2', value: 'dog', language: 'en' },
    foreignWord: { id: 'mock-hy-2', value: 'շուն', language: 'hy' },
    transliteration: 'shun',
    ttsFile: 'armenian/dog.mp3',
}

// English → Greek: "dog" → "σκύλος". Greek is `el` since the app's gr → el
// code migration, and it now supports transliteration (rendered in the UI).
export const dogTranslationMockEl: Translation = {
    id: 'mock-id-el',
    englishWord: { id: 'mock-en-3', value: 'dog', language: 'en' },
    foreignWord: { id: 'mock-el-1', value: 'σκύλος', language: 'el' },
    transliteration: 'skýlos',
    ttsFile: '',
}

/**
 * Enrichment in the shape the API has sent since #424: one entry per meaning,
 * each owning its own headword, synonyms, forms and examples. The flat
 * `synonyms` / `examples` lists that used to sit on the word are gone.
 *
 * Inside an example, `source` is the study-language sentence (the one the panel
 * highlights), `translation` is the English one, and `targetToken` is the
 * surface form in `source` the learner is meant to notice — often inflected,
 * which is what the per-form example filter is built on.
 */
export const dogEnrichmentHy: WordEnrichment = {
    senses: [
        {
            senseKey: 'main',
            targetHeadword: 'շուն',
            targetTransliteration: 'šun',
            briefGloss: 'domesticated canine animal',
            primary: true,
            sourcePartOfSpeech: 'noun',
            targetPartOfSpeech: 'noun',
            forms: [
                { value: 'շունը', label: 'nominative singular definite' },
                { value: 'շան', label: 'genitive singular' },
            ],
            synonyms: [
                { value: 'շնիկ', register: 'colloquial', note: 'diminutive', transliteration: 'shnik' },
                { value: 'սուն', register: 'rare', note: 'dialectal' },
            ],
            examples: [
                { source: 'Շունը հաչում է։', translation: 'The dog is barking.', targetToken: 'շունը' },
                { source: 'Ես շան հետ եմ խաղում։', translation: 'I am playing with the dog.', targetToken: 'շան' },
            ],
            grammar: { partOfSpeech: 'noun', gender: 'masculine' },
        },
        {
            senseKey: 'scoundrel',
            targetHeadword: 'սրիկա',
            briefGloss: 'contemptible person',
            synonyms: [{ value: 'անպիտան' }],
        },
        // A baseline-only meaning: a headword and nothing else. The panel has
        // nothing to show for it, and must still let the learner back out.
        {
            senseKey: 'pursue',
            targetHeadword: 'հետապնդել',
            briefGloss: 'to follow persistently',
        },
    ],
    reviewStatus: 'passed',
    grammar: { partOfSpeech: 'noun', gender: 'masculine' },
}
