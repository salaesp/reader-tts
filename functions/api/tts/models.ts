import type { TtsModel } from '../../../shared/types'
import type { Api } from '../../lib/env'
import { HttpError, json, requireUser } from '../../lib/http'
import { getApiKey } from '../../lib/settings'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

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

/**
 * Lists the OpenRouter models that can produce audio, so the Settings screen
 * never has to hardcode a model id. Cached at the edge for an hour.
 */
export const onRequestGet: Api = async ({ env, data }) => {
  const user = requireUser(data.user)

  const apiKey = await getApiKey(env, user.id)
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit)

  if (!response.ok) {
    throw new HttpError(502, 'models_fetch_failed', `upstream status ${response.status}`)
  }

  const body = (await response.json()) as { data?: OpenRouterModel[] }
  const models: TtsModel[] = (body.data ?? [])
    .filter(producesAudio)
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      voices: extractVoices(model),
      pricing: model.pricing?.audio ?? model.pricing?.completion ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return json(
    { models },
    { headers: { 'cache-control': 'private, max-age=600' } },
  )
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

function extractVoices(model: OpenRouterModel): string[] {
  const raw = model.voices
  if (!Array.isArray(raw)) return []
  return raw
    .map((voice) =>
      typeof voice === 'string'
        ? voice
        : typeof (voice as { id?: unknown })?.id === 'string'
          ? ((voice as { id: string }).id)
          : null,
    )
    .filter((voice): voice is string => Boolean(voice))
}
