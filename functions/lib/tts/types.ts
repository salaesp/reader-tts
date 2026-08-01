import type { AudioFormat, TtsModel, TtsVoice } from '../../../shared/types'

export interface SynthesisRequest {
  apiKey: string
  model: string
  voice: string
  text: string
  /** Sent to OpenRouter as the attribution referer; unused by ElevenLabs. */
  origin: string
  /** Format known to work for this model, so the probe is not repeated. */
  format?: AudioFormat
}

export interface SynthesisResult {
  audio: ArrayBuffer
  contentType: string
  /** Upstream request id, when the provider returns one. Useful for support. */
  generationId: string
  /** What the provider actually accepted, to be remembered for next time. */
  format: AudioFormat
}

export interface TtsProviderClient {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>
  /** Models the account can use for synthesis, with their voices when known. */
  listModels(apiKey: string | null): Promise<TtsModel[]>
  /**
   * Voices for one model, when finding them costs an extra request and is
   * therefore not worth doing for the whole catalogue. Optional: a provider
   * whose catalogue already carries them has nothing more to fetch.
   */
  listVoices?(apiKey: string | null, modelId: string): Promise<TtsVoice[]>
  /**
   * The provider's own response for the first `limit` models, unprocessed.
   * Only for finding out where a provider hides its voice list; optional
   * because a provider whose schema is documented has nothing to reveal.
   */
  rawModels?(apiKey: string | null, limit: number): Promise<unknown>
}

export function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
