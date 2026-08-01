import type { TtsModel } from '../../../shared/types'

export interface SynthesisRequest {
  apiKey: string
  model: string
  voice: string
  text: string
  /** Sent to OpenRouter as the attribution referer; unused by ElevenLabs. */
  origin: string
}

export interface SynthesisResult {
  audio: ArrayBuffer
  contentType: string
  /** Upstream request id, when the provider returns one. Useful for support. */
  generationId: string
}

export interface TtsProviderClient {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>
  /** Models the account can use for synthesis, with their voices when known. */
  listModels(apiKey: string | null): Promise<TtsModel[]>
}

export function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
