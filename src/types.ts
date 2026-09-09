export type Language =
    | "ru"
    | "en"
    | "hy"
    // Greek's canonical app-state code is `el`. `gr` is the legacy code, still
    // accepted server-side as an alias (some API tests exercise it directly).
    | "el"
    | "gr";

export interface Word {
    id: string;
    value: string;
    language: Language;
}

export type SynonymRegister =
    | "common"
    | "literary"
    | "formal"
    | "colloquial"
    | "archaic"
    | "poetic"
    | "technical"
    | "rare";

export interface SynonymEntry {
    value: string;
    transliteration?: string;
    register?: SynonymRegister;
    note?: string;
}

export type WordCommonness =
    | "very_common"
    | "common"
    | "uncommon"
    | "rare";

export interface WordGrammar {
    partOfSpeech: string;
    gender?: "masculine" | "feminine" | "neuter" | "common";
    article?: string;
    number?: "singular" | "plural" | "uncountable" | "invariant";
    aspect?: "perfective" | "imperfective" | "biaspectual";
    notes?: string;
}

/** A target-language surface form that may show up in an example. */
export interface WordFormDetail {
    value: string;
    /** Short English morphology label, e.g. "1st person singular". */
    label?: string;
}

/**
 * One meaning of a word. Synonyms, forms and examples belong to the meaning and
 * are never shared across the lexeme — the invariant the app's relational
 * lexical model exists to enforce (#424).
 */
export interface WordSenseEnrichment {
    /** Stable key within the word, e.g. "ability"; "main" when there is one meaning. */
    senseKey: string;
    targetHeadword: string;
    targetTransliteration?: string;
    /** Two-to-five-word English meaning note; the label on the meaning's tab. */
    briefGloss?: string;
    targetGloss?: string;
    sourceSynonyms?: string[];
    commonness?: WordCommonness;
    register?: SynonymRegister;
    sourcePartOfSpeech?: string;
    targetPartOfSpeech?: string;
    primary?: boolean;
    forms?: WordFormDetail[];
    examples?: { source: string; translation: string; targetToken: string }[];
    synonyms?: SynonymEntry[];
    grammar?: WordGrammar;
}

export interface WordEnrichment {
    /** The word's meanings. The flat synonyms/examples lists are gone (#424). */
    senses?: WordSenseEnrichment[];
    reviewStatus?: "unreviewed" | "passed" | "needs_review" | "needs_repair";
    reviewVersion?: string;
    /** Grammar of the primary sense's target word, kept for cards and chips. */
    grammar?: WordGrammar;
}

export interface TranslationVariant {
    wordId?: number;
    partOfSpeech?: string;
    englishWord: Word;
    foreignWord: Word;
    transliteration?: string;
    ttsFile?: string;
    enrichment?: WordEnrichment;
}

export interface Translation extends TranslationVariant {
    id: string;
    variants?: TranslationVariant[];
}

export interface MyMemoryMatch {
    segment: string;
    translation: string;
    quality: string | number;
}

export interface MyMemoryResponse {
    matches: MyMemoryMatch[];
    responseData: {
        translatedText: string;
    };
}

export interface ImageDTO {
    id: string;
    urlSmall: string;
    urlLarge: string;
    wordValue: string;
    description: string;
}

export interface User {
    id: string;
    createdAt: number;
    updatedAt: number;
    name: string;
    email: string;
}

export interface Card {
    id: string;
    createdAt: number;
    updatedAt: number;
    wordId?: number;
    languagePair: Language[];
    translation: Translation;
    imageUrlSmall: string;
    imageUrlLarge: string;
    user?: User;
    ttsFile?: string;
    score?: number;
}

/** One word in a target language, as returned by POST /api/cards/translate. */
export interface CardTranslation {
    word: string;
    transliteration?: string;
    ttsFile?: string;
}

/** Response shape of POST /api/cards/translate (mp-runtime's ctx.translate). */
export interface CardsTranslateResponse {
    translations: Record<string, Partial<Record<Language, CardTranslation | null>>>;
}

export interface GameCardRequirements {
    minCards: number;
    maxCards?: number;
    topicPack?: string;
    deckSlug?: string;
    maxTier?: number;
}

export type GameCardFocus =
    | { mode: "default" }
    | { mode: "cards"; cardIds: string[] };

export interface GameAppInfo {
    name: string;
    url: string;
    title: string;
    description: string;
    icon: string;
    cover?: string;
    minCards?: number;
    requires?: GameCardRequirements;
}

export interface LocalSettings {
    UNSPLASH_ACCESS_KEY: string;
    SUPABASE_URL: string;
    SUPABASE_KEY: string;
    /** Cloudflare Turnstile site key. Empty string disables CAPTCHA on auth. */
    TURNSTILE_SITE_KEY?: string;
    games?: GameAppInfo[];
    allowGameOverride?: boolean;
    /** Games anonymous/guest users may launch. null = all games allowed. */
    anonAllowedGames?: string[] | null;
}

export interface TranslateRequest {
    word: string;
    selectedSourceLang: Language
    selectedTargetLang: Language
}

export type PumpBuildStatus =
    | "dirty"
    | "building"
    | "ready"
    | "failed";

export type PumpNextResponse =
    | {
        done: true;
        totalRemaining?: number;
    }
    | {
        done: false;
        lemmaId: number;
        englishLemma: string;
        position?: number;
        totalRemaining?: number;
    };

export interface PumpStatusResponse {
    subscribedPackCount: number;
    savedLemmaCount: number;
    totalLemmaCount: number;
    queueDepth: number;
    queueDirty: boolean;
    buildStatus: PumpBuildStatus;
}
