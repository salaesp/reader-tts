import type { TtsModel, TtsVoice } from '../../../shared/types'
import { HttpError } from '../http'
import type { SynthesisRequest, SynthesisResult, TtsProviderClient } from './types'
import { truncate } from './types'

const SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech'

/**
 * The unfiltered model list does not include TTS models at all: asking for
 * `output_modalities=speech` is the only way they show up. Without it the
 * Settings selector offered chat and music models, every one of which the
 * speech endpoint rejects with "Model does not exist".
 */
const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=speech'

interface OpenRouterModel {
  id: string
  name?: string
  architecture?: {
    output_modalities?: string[]
    input_modalities?: string[]
    modality?: string
  }
  pricing?: Record<string, string>
  supported_parameters?: string[]
  /** Not part of the documented schema; used when a provider advertises it. */
  voices?: unknown
}

export const openRouter: TtsProviderClient = {
  async synthesize({ apiKey, model, voice, text, origin }: SynthesisRequest): Promise<SynthesisResult> {
    const upstream = await fetch(SPEECH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'http-referer': origin,
        'x-title': 'Reader TTS',
      },
      body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
    })

    if (!upstream.ok) {
      // Only error responses are JSON; a 200 is raw audio bytes.
      const detail = await upstream.text()
      // A rejected key must not surface as 401: the client reads that as an
      // expired session and would bounce the user back to the login screen.
      const rejectedKey = upstream.status === 401 || upstream.status === 403
      throw new HttpError(
        rejectedKey ? 403 : 502,
        rejectedKey ? 'invalid_api_key' : 'tts_failed',
        truncate(detail),
      )
    }

    return {
      audio: await upstream.arrayBuffer(),
      contentType: upstream.headers.get('content-type') ?? 'audio/mpeg',
      generationId: upstream.headers.get('x-generation-id') ?? '',
    }
  },

  async listModels(apiKey: string | null): Promise<TtsModel[]> {
    const response = await fetch(MODELS_URL, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit)

    if (!response.ok) {
      throw new HttpError(502, 'models_fetch_failed', `upstream status ${response.status}`)
    }

    const body = (await response.json()) as { data?: OpenRouterModel[] }
    return (body.data ?? [])
      .filter(producesAudio)
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        voices: extractVoices(model),
        pricing: model.pricing?.audio ?? model.pricing?.completion ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
}

function producesAudio(model: OpenRouterModel): boolean {
  const outputs = model.architecture?.output_modalities
  if (outputs?.length) {
    return outputs.some((modality) => modality === 'audio' || modality === 'speech')
  }
  // Older entries only expose the combined "text->audio" modality string.
  const modality = model.architecture?.modality ?? ''
  return modality.includes('->audio') || modality.includes('->speech')
}

function extractVoices(model: OpenRouterModel): TtsVoice[] {
  const raw = model.voices
  if (!Array.isArray(raw)) return []
  return raw
    .map((voice) => {
      if (typeof voice === 'string') return { id: voice, name: voice }
      const id = (voice as { id?: unknown })?.id
      if (typeof id !== 'string') return null
      const name = (voice as { name?: unknown })?.name
      return { id, name: typeof name === 'string' ? name : id }
    })
    .filter((voice): voice is TtsVoice => voice !== null)
}
