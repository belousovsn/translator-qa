import type { Translation } from '../../src/types.js'

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

// English → Greek: "dog" → "σκύλος"
// Greek's canonical language code is `el` (the app migrated off the legacy `gr`).
export const dogTranslationMockEl: Translation = {
    id: 'mock-id-el',
    englishWord: { id: 'mock-en-3', value: 'dog', language: 'en' },
    foreignWord: { id: 'mock-el-1', value: 'σκύλος', language: 'el' },
    transliteration: '',
    ttsFile: '',
}
