import type { ReadingLang, TtsModel, TtsProvider, TtsVoice } from '../../shared/types'
import { GOOGLE_VOICES, OPENAI_VOICES } from '../../shared/types'
import { ApiError, api } from './api'
import { chunkHash } from './segmenter'
import { store } from './store'

/**
 * Two ways to turn a chunk of text into speech:
 *
 *  - `CloudTtsEngine` renders audio server-side — through OpenRouter or
 *    ElevenLabs, whichever the user picked — and hands back a Blob, which the
 *    player schedules like any other audio source. Results are cached in
 *    IndexedDB, so re-listening on this device is free.
 *  - `BrowserVoiceEngine` speaks through the Web Speech API. No key, no cost,
 *    works offline — but it produces no audio buffer, so the player drives it
 *    through the same interface with a synthetic "playback" lifecycle.
 */

export interface SynthesisResult {
  kind: 'audio'
  blob: Blob
}

export interface TtsEngineContext {
  lang: ReadingLang
  bookId: string
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('no_api_key')
    this.name = 'MissingApiKeyError'
  }
}

export class CloudTtsEngine {
  readonly kind = 'cloud' as const

  constructor(
    readonly provider: TtsProvider,
    private readonly model: string,
    private readonly voice: string,
  ) {}

  /** Stable identity for a chunk, shared by the local and server caches. */
  hash(text: string): Promise<string> {
    return chunkHash(this.provider, this.model, this.voice, text)
  }

  async synthesize(
    text: string,
    context: TtsEngineContext,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const hash = await this.hash(text)

    const cached = await store.getAudio(hash)
    if (cached) return cached

    try {
      const blob = await api.synthesize(
        {
          text,
          hash,
          provider: this.provider,
          model: this.model,
          voice: this.voice,
          bookId: context.bookId,
        },
        signal,
      )
      void store.saveAudio(hash, context.bookId, blob)
      return blob
    } catch (err) {
      if (err instanceof ApiError && err.needsApiKey) throw new MissingApiKeyError()
      throw err
    }
  }
}

/**
 * Voices to offer for the selected model.
 *
 * ElevenLabs voices belong to the account, not to the model, so every model in
 * the response carries the same list — which means a model id typed by hand,
 * one too new to be in the catalogue say, still gets the real picker.
 *
 * OpenRouter voices are per model and it publishes none of them, so they are
 * inferred from the model id; an unrecognised one yields nothing and the UI
 * offers a free text field rather than a wrong list.
 */
export function voicesFor(
  provider: TtsProvider,
  models: TtsModel[],
  modelId: string,
): TtsVoice[] {
  const selected = models.find((model) => model.id === modelId)
  if (selected?.voices.length) return selected.voices

  if (provider === 'elevenlabs') {
    return models.find((model) => model.voices.length > 0)?.voices ?? []
  }

  const names = modelId.startsWith('openai/')
    ? OPENAI_VOICES
    : modelId.startsWith('google/')
      ? GOOGLE_VOICES
      : []
  return names.map((name) => ({ id: name, name }))
}

/**
 * Last-resort order when the device says nothing useful about which regional
 * variant to prefer. It is a tiebreak, not a preference: the chosen voice and
 * then the device's own locale both come first, because hardcoding es-ES here
 * meant a reader in Buenos Aires got a Spanish accent while their Latin
 * American voices sat unused.
 */
const VOICE_LOCALES: Record<ReadingLang, string[]> = {
  es: ['es-ES', 'es-MX', 'es-US', 'es-AR', 'es'],
  en: ['en-US', 'en-GB', 'en'],
}

const normalizeLang = (lang: string): string => lang.replace('_', '-')

/**
 * Which browser voice to use, remembered per device.
 *
 * Not a server-side setting: the voices come from the operating system, so the
 * list on an Android phone has nothing in common with the one on a laptop and
 * a synced choice would name a voice that does not exist on the other device.
 */
const VOICE_PREF_KEY = 'browser-voice'

export function readVoicePreference(lang: ReadingLang): string | null {
  try {
    return localStorage.getItem(`${VOICE_PREF_KEY}:${lang}`)
  } catch {
    return null
  }
}

export function writeVoicePreference(lang: ReadingLang, voiceUri: string | null): void {
  try {
    if (voiceUri) localStorage.setItem(`${VOICE_PREF_KEY}:${lang}`, voiceUri)
    else localStorage.removeItem(`${VOICE_PREF_KEY}:${lang}`)
  } catch {
    // Private mode: the pick just does not survive a reload.
  }
}

/** The device's voices for a reading language, best-sounding ones first. */
export function browserVoicesFor(
  voices: SpeechSynthesisVoice[],
  lang: ReadingLang,
): SpeechSynthesisVoice[] {
  return voices
    .filter((voice) => normalizeLang(voice.lang).toLowerCase().startsWith(lang))
    .sort((a, b) => {
      // Network voices are markedly better than the built-in ones; on Android
      // these are the same voices Chrome's own "read aloud" uses.
      if (a.localService !== b.localService) return a.localService ? 1 : -1
      return a.name.localeCompare(b.name)
    })
}

/** Web Speech API voices load asynchronously in most browsers. */
export function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([])

  const existing = speechSynthesis.getVoices()
  if (existing.length > 0) return Promise.resolve(existing)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(speechSynthesis.getVoices()), 1500)
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(timeout)
        resolve(speechSynthesis.getVoices())
      },
      { once: true },
    )
  })
}

/**
 * Resolves the voice to speak with, in order of how much it is worth trusting:
 * what the reader picked on this device, then the device's own regional
 * variant, then the fallback order.
 */
export function pickBrowserVoice(
  voices: SpeechSynthesisVoice[],
  lang: ReadingLang,
  preferredUri: string | null = readVoicePreference(lang),
): SpeechSynthesisVoice | null {
  const candidates = browserVoicesFor(voices, lang)
  if (candidates.length === 0) return null

  if (preferredUri) {
    const chosen = candidates.find((voice) => voice.voiceURI === preferredUri)
    if (chosen) return chosen
  }

  // "es-AR" on the device should read in Rioplatense, not Peninsular Spanish.
  const deviceLocale = normalizeLang(navigator.language ?? '')
  if (deviceLocale.toLowerCase().startsWith(lang)) {
    const match = candidates.find(
      (voice) => normalizeLang(voice.lang).toLowerCase() === deviceLocale.toLowerCase(),
    )
    if (match) return match
  }

  for (const locale of VOICE_LOCALES[lang]) {
    const exact = candidates.find((voice) => normalizeLang(voice.lang) === locale)
    if (exact) return exact
  }
  return candidates[0]
}

export function browserVoiceAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
}

export class BrowserVoiceEngine {
  readonly kind = 'browser' as const
  private voices: SpeechSynthesisVoice[] = []

  async prepare(): Promise<void> {
    this.voices = await loadBrowserVoices()
  }

  /**
   * Speaks the text and resolves when the utterance finishes. Rejects on abort
   * so the player can treat it like a cancelled fetch.
   */
  speak(
    text: string,
    options: {
      lang: ReadingLang
      rate: number
      signal: AbortSignal
      /** Character index reached in `text`, when the browser reports boundaries. */
      onBoundary?: (charIndex: number) => void
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!browserVoiceAvailable()) {
        reject(new Error('speech synthesis unavailable'))
        return
      }
      if (options.signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'))
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      const voice = pickBrowserVoice(this.voices, options.lang)
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang ?? (options.lang === 'es' ? 'es-ES' : 'en-US')
      // The Web Speech rate range is wider than ours but clamps oddly past 2.
      utterance.rate = Math.min(2, Math.max(0.5, options.rate))

      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        options.signal.removeEventListener('abort', onAbort)
        fn()
      }

      const onAbort = (): void => {
        speechSynthesis.cancel()
        finish(() => reject(new DOMException('aborted', 'AbortError')))
      }

      if (options.onBoundary) {
        utterance.onboundary = (event) => options.onBoundary?.(event.charIndex)
      }
      utterance.onend = () => finish(resolve)
      utterance.onerror = (event) => {
        // Cancelling produces an 'interrupted'/'canceled' error, not a failure.
        if (event.error === 'interrupted' || event.error === 'canceled') {
          finish(() => reject(new DOMException('aborted', 'AbortError')))
          return
        }
        finish(() => reject(new Error(`speech synthesis failed: ${event.error}`)))
      }

      options.signal.addEventListener('abort', onAbort, { once: true })
      speechSynthesis.cancel()
      speechSynthesis.speak(utterance)
    })
  }

  stop(): void {
    if (browserVoiceAvailable()) speechSynthesis.cancel()
  }
}
