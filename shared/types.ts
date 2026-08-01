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

export const DEFAULT_TTS_MODEL = 'google/chirp-3'
export const DEFAULT_TTS_VOICE = 'Kore'
export const DEFAULT_SPEED = 1

/**
 * Voices published for Google's Chirp 3 HD line. Used as the fallback list when
 * OpenRouter's model metadata does not advertise voices for the selected model.
 */
export const CHIRP3_VOICES = [
  'Aoede',
  'Charon',
  'Fenrir',
  'Kore',
  'Leda',
  'Orus',
  'Puck',
  'Zephyr',
]
