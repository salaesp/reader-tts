import type { TtsProvider } from '../../../shared/types'
import { elevenLabs } from './elevenlabs'
import { openRouter } from './openrouter'
import type { TtsProviderClient } from './types'

const CLIENTS: Record<TtsProvider, TtsProviderClient> = {
  openrouter: openRouter,
  elevenlabs: elevenLabs,
}

export function clientFor(provider: TtsProvider): TtsProviderClient {
  return CLIENTS[provider]
}

export type { SynthesisRequest, SynthesisResult, TtsProviderClient } from './types'
