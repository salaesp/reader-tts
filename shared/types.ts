/** Types shared between the browser app and the Cloudflare Functions. */

export type UiLang = 'es' | 'en'
export type ReadingLang = 'es' | 'en'

/** Cloud synthesis backends. The browser voice is a separate toggle. */
export type TtsProvider = 'openrouter' | 'elevenlabs'

export const TTS_PROVIDERS: TtsProvider[] = ['openrouter', 'elevenlabs']

export function isTtsProvider(value: unknown): value is TtsProvider {
  return value === 'openrouter' || value === 'elevenlabs'
}

/** Brand names, identical in every UI language. */
export const PROVIDER_LABELS: Record<TtsProvider, string> = {
  openrouter: 'OpenRouter',
  elevenlabs: 'ElevenLabs',
}

export const PROVIDER_KEY_URLS: Record<TtsProvider, string> = {
  openrouter: 'https://openrouter.ai/keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
}

export interface User {
  id: string
  email: string
  name: string
  picture: string | null
}

/**
 * Model and voice are stored per provider: switching between OpenRouter and
 * ElevenLabs to compare them must not clobber the other one's selection, and
 * the two id namespaces have nothing in common anyway.
 */
export interface ProviderSettings {
  /** Whether a key is stored server-side. The key itself is never returned. */
  hasApiKey: boolean
  /** Last 4 characters of the stored key, for recognition in the UI. */
  apiKeyHint: string | null
  model: string
  voice: string
}

export interface Settings {
  /** Which cloud backend synthesizes audio when the browser voice is off. */
  ttsProvider: TtsProvider
  providers: Record<TtsProvider, ProviderSettings>
  speed: number
  uiLang: UiLang
  readingLang: ReadingLang
  /** Use the browser's Web Speech API instead of a cloud provider. */
  useBrowserVoice: boolean
}

export interface SettingsUpdate {
  ttsProvider?: TtsProvider
  /** Applies to `provider` when given, otherwise to the active provider. */
  provider?: TtsProvider
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

/**
 * ElevenLabs voices are opaque ids (`21m00Tcm4TlvDq8ikWAM`), so a display name
 * has to travel alongside. OpenRouter voices are their own name.
 */
export interface TtsVoice {
  id: string
  name: string
}

export interface TtsModel {
  id: string
  name: string
  /** Voices advertised by the provider, when available. */
  voices: TtsVoice[]
  pricing: string | null
}

export interface TtsRequest {
  text: string
  /**
   * sha-256 of `${provider}|${model}|${voice}|${text}`, the key of the local
   * audio cache. Speed is deliberately excluded: it is applied through the
   * audio element's playbackRate, so one rendering serves every speed.
   */
  hash: string
  provider?: TtsProvider
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
export const DEFAULT_TTS_PROVIDER: TtsProvider = 'openrouter'

/**
 * `eleven_multilingual_v2` reads Spanish and English well with any voice, which
 * is what this app needs; the voice is left empty because ids are per account —
 * Settings picks the first one the account exposes.
 */
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2'
export const DEFAULT_ELEVENLABS_VOICE = ''

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
