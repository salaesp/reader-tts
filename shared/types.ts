/** Types shared between the browser app and the Cloudflare Functions. */

export type UiLang = 'es' | 'en'
export type ReadingLang = 'es' | 'en'

export interface User {
  id: string
  email: string
  name: string
  picture: string | null
}

export interface Settings {
  /** Whether an OpenRouter key is stored server-side. The key itself is never returned. */
  hasApiKey: boolean
  /** Last 4 characters of the stored key, for recognition in the UI. */
  apiKeyHint: string | null
  ttsModel: string
  ttsVoice: string
  speed: number
  uiLang: UiLang
  readingLang: ReadingLang
  /** Use the browser's Web Speech API instead of OpenRouter. */
  useBrowserVoice: boolean
}

export interface SettingsUpdate {
  apiKey?: string | null
  ttsModel?: string
  ttsVoice?: string
  speed?: number
  uiLang?: UiLang
  readingLang?: ReadingLang
  useBrowserVoice?: boolean
}

export interface Book {
  id: string
  title: string
  author: string | null
  language: string | null
  sizeBytes: number
  hasCover: boolean
  addedAt: number
  progress: Progress | null
}

export interface Progress {
  chapterIndex: number
  chunkIndex: number
  charOffset: number
  percent: number
  updatedAt: number
}

export interface TtsModel {
  id: string
  name: string
  /** Voice ids advertised by the provider, when available. */
  voices: string[]
  pricing: string | null
}

export interface TtsRequest {
  text: string
  /**
   * sha-256 of `${model}|${voice}|${text}`, the key of the local audio cache.
   * Speed is deliberately excluded: it is applied through the audio element's
   * playbackRate, so one rendering serves every speed.
   */
  hash: string
  model?: string
  voice?: string
  /** Scopes the cache entry so deleting a book also drops its audio. */
  bookId?: string
}

export interface ApiError {
  error: string
  detail?: string
}

/**
 * `google/chirp-3` does not exist on OpenRouter — the speech endpoint rejects
 * it. The real catalogue is whatever `/models?output_modalities=speech`
 * returns; this is the Google entry in it, and its voice names carry over from
 * the Chirp line.
 */
export const DEFAULT_TTS_MODEL = 'google/gemini-3.1-flash-tts-preview'
export const DEFAULT_TTS_VOICE = 'Kore'
export const DEFAULT_SPEED = 1

/**
 * Fallback voice lists, used when OpenRouter's model metadata does not
 * advertise voices for the selected model — which today is every model.
 */
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
]

/** Google's voice names, shared by the Chirp 3 HD and Gemini TTS lines. */
export const GOOGLE_VOICES = [
  'Aoede',
  'Charon',
  'Fenrir',
  'Kore',
  'Leda',
  'Orus',
  'Puck',
  'Zephyr',
]
