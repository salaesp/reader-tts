/** Types shared between the browser app and the Cloudflare Functions. */

export type UiLang = 'es' | 'en'
export type ReadingLang = 'es' | 'en'

/** Cloud synthesis backends. The browser voice is a separate toggle. */
export type TtsProvider = 'openrouter' | 'elevenlabs'

export const TTS_PROVIDERS: TtsProvider[] = ['openrouter', 'elevenlabs']

export function isTtsProvider(value: unknown): value is TtsProvider {
  return value === 'openrouter' || value === 'elevenlabs'
}

/**
 * Audio the provider is asked for. mp3 is roughly a tenth the size, but the
 * Gemini TTS line only emits pcm and rejects a request for mp3 outright, so it
 * cannot simply be hardcoded.
 */
export type AudioFormat = 'mp3' | 'pcm'

export function isAudioFormat(value: unknown): value is AudioFormat {
  return value === 'mp3' || value === 'pcm'
}

export const DEFAULT_AUDIO_FORMAT: AudioFormat = 'mp3'

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

/**
 * Where a model's voice list came from. Worth showing: a guessed list that
 * happens to be wrong produces a 400 with nothing pointing at the voice, so
 * the reader should know when they are looking at one.
 */
export type VoiceSource = 'provider' | 'inferred' | 'unknown'

/**
 * What OpenRouter charges, in USD per token.
 *
 * Text-to-speech bills the text you send, so the cost sits in the *input*
 * price; `completion` is reported as "0" for every speech model seen. Reading
 * the completion price and showing that meant advertising paid models as free.
 */
export interface TtsPricing {
  input: number | null
  /** Only when a provider prices its audio output separately. */
  output: number | null
}

export interface TtsModel {
  id: string
  name: string
  voices: TtsVoice[]
  voiceSource: VoiceSource
  pricing: TtsPricing | null
}

/**
 * Per-token prices are unreadable at their natural scale ($0.000015), so they
 * are shown per million tokens the way OpenRouter's own catalogue does.
 */
export function formatPricePerMillion(usdPerToken: number): string {
  const perMillion = usdPerToken * 1_000_000
  if (perMillion === 0) return '0'
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`
  const rounded = perMillion.toFixed(2).replace(/\.?0+$/, '')
  return `$${rounded}`
}

/**
 * A one-line price for a model, or null when nothing usable is published.
 *
 * Anything that is not recognisably a price returns null rather than a
 * conclusion. The shape of this field has already changed once, and a client
 * holding a cached response from before the change read every model as free —
 * quietly turning "unknown" into a claim about money.
 */
export function describePricing(pricing: unknown, freeLabel: string): string | null {
  if (pricing === null || typeof pricing !== 'object') return null

  const input = asPrice((pricing as TtsPricing).input)
  const output = asPrice((pricing as TtsPricing).output)
  if (input === null && output === null) return null
  if (!input && !output) return freeLabel

  const parts: string[] = []
  if (input) parts.push(`${formatPricePerMillion(input)}/M`)
  // Almost always absent; shown only when a provider really does bill it.
  if (output) parts.push(`+${formatPricePerMillion(output)}/M out`)
  return parts.join(' ')
}

/** A finite number or nothing. A missing price is not a price of zero. */
function asPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Characters per token, for turning a chapter's length into a cost.
 *
 * A guess, and the weakest link in any estimate built on it: OpenRouter bills
 * tokens and publishes no ratio for speech. Spanish tokenises worse than
 * English because of accented characters, hence the two values. Neither has
 * been checked against a real invoice, so anything derived from them is shown
 * as approximate and never as a charge.
 */
export const CHARS_PER_TOKEN: Record<ReadingLang, number> = { es: 3.5, en: 4 }

export function estimateTokens(chars: number, lang: ReadingLang): number {
  return chars / CHARS_PER_TOKEN[lang]
}

export interface UsdEstimate {
  usd: number
  /**
   * True when the model also bills output. Audio duration does not follow from
   * text length, so the figure is a floor rather than a total.
   */
  isFloor: boolean
}

/**
 * Estimated dollars for a number of characters, or null when the price is
 * unknown — the same refusal as `describePricing`, for the same reason.
 */
export function estimateUsd(
  chars: number,
  lang: ReadingLang,
  pricing: TtsPricing | null,
): UsdEstimate | null {
  const input = pricing ? asPrice(pricing.input) : null
  if (input === null) return null

  return { usd: estimateTokens(chars, lang) * input, isFloor: Boolean(pricing?.output) }
}

/** Money at the scale a chapter costs: cents matter, four decimals do not. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 10) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(1)}`
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

/**
 * Last resort when OpenRouter publishes no voices for a model: guess from the
 * id. Only these two providers can be guessed at all, and even then the guess
 * can go stale — anything else returns nothing so the UI offers a free text
 * field rather than a list that produces 400s.
 *
 * Shared so the server and the Settings screen agree on the same guess; they
 * both need it, the server for the catalogue and the client for a model id
 * typed by hand.
 */
export function inferVoices(modelId: string): TtsVoice[] {
  const names = modelId.startsWith('openai/')
    ? OPENAI_VOICES
    : modelId.startsWith('google/')
      ? GOOGLE_VOICES
      : []
  return names.map((name) => ({ id: name, name }))
}
