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
export const dogTranslationMockGr: Translation = {
    id: 'mock-id-gr',
    englishWord: { id: 'mock-en-3', value: 'dog', language: 'en' },
    foreignWord: { id: 'mock-gr-1', value: 'σκύλος', language: 'gr' },
    transliteration: '',
    ttsFile: '',
}
