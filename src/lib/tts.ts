import type { ReadingLang } from '../../shared/types'
import { ApiError, api } from './api'
import { chunkHash } from './segmenter'
import { store } from './store'

/**
 * Two ways to turn a chunk of text into speech:
 *
 *  - `OpenRouterEngine` renders audio server-side and hands back a Blob, which
 *    the player schedules like any other audio source. Results are cached in
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

export class OpenRouterEngine {
  readonly kind = 'openrouter' as const

  constructor(
    private readonly model: string,
    private readonly voice: string,
  ) {}

  /** Stable identity for a chunk, shared by the local and server caches. */
  hash(text: string): Promise<string> {
    return chunkHash(this.model, this.voice, text)
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
        { text, hash, model: this.model, voice: this.voice, bookId: context.bookId },
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

const VOICE_LOCALES: Record<ReadingLang, string[]> = {
  es: ['es-ES', 'es-MX', 'es-US', 'es-AR', 'es'],
  en: ['en-US', 'en-GB', 'en'],
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

export function pickBrowserVoice(
  voices: SpeechSynthesisVoice[],
  lang: ReadingLang,
): SpeechSynthesisVoice | null {
  for (const locale of VOICE_LOCALES[lang]) {
    const exact = voices.find((voice) => voice.lang.replace('_', '-') === locale)
    if (exact) return exact
  }
  const prefix = voices.find((voice) => voice.lang.toLowerCase().startsWith(lang))
  return prefix ?? null
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
