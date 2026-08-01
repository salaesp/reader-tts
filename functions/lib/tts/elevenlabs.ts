import type { TtsModel, TtsVoice } from '../../../shared/types'
import { HttpError } from '../http'
import type { SynthesisRequest, SynthesisResult, TtsProviderClient } from './types'
import { truncate } from './types'

const BASE_URL = 'https://api.elevenlabs.io'

/**
 * The one format available on every plan. Higher bitrates and PCM are gated
 * behind paid tiers and fail with 401, which would read as a bad key.
 */
const OUTPUT_FORMAT = 'mp3_44100_128'

interface ElevenLabsModel {
  model_id: string
  name?: string
  can_do_text_to_speech?: boolean
  languages?: { language_id: string; name?: string }[]
}

interface ElevenLabsVoice {
  voice_id: string
  name?: string
  category?: string
}

/** ElevenLabs errors are `{detail: {status, message}}` or `{detail: "..."}`. */
interface ElevenLabsError {
  detail?: string | { status?: string; message?: string }
}

export const elevenLabs: TtsProviderClient = {
  async synthesize({ apiKey, model, voice, text }: SynthesisRequest): Promise<SynthesisResult> {
    // Unlike OpenRouter, the voice is part of the path, so an empty one would
    // silently hit a different endpoint instead of erroring.
    if (!voice) throw new HttpError(400, 'no_voice_selected')

    const url = `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: model }),
    })

    if (!upstream.ok) {
      // Only error responses are JSON; a 200 is raw audio bytes.
      throw await upstreamError(upstream, 'tts_failed')
    }

    return {
      audio: await upstream.arrayBuffer(),
      contentType: upstream.headers.get('content-type') ?? 'audio/mpeg',
      generationId: upstream.headers.get('request-id') ?? '',
      // OUTPUT_FORMAT pins mp3, so there is nothing to discover here.
      format: 'mp3',
    }
  },

  /**
   * Voices belong to the account, not to a model, so the same list is attached
   * to every model. That keeps the Settings screen's model + voice pair working
   * unchanged across providers.
   */
  async listModels(apiKey: string | null): Promise<TtsModel[]> {
    if (!apiKey) throw new HttpError(412, 'no_api_key')

    const [models, voices] = await Promise.all([fetchModels(apiKey), fetchVoices(apiKey)])

    return models
      .filter((model) => model.can_do_text_to_speech !== false)
      .map((model) => ({
        id: model.model_id,
        name: model.name ?? model.model_id,
        voices,
        pricing: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
}

async function fetchModels(apiKey: string): Promise<ElevenLabsModel[]> {
  const response = await fetch(`${BASE_URL}/v1/models`, { headers: { 'xi-api-key': apiKey } })
  if (!response.ok) throw await upstreamError(response, 'models_fetch_failed')

  const body = (await response.json()) as ElevenLabsModel[] | { models?: ElevenLabsModel[] }
  const models = Array.isArray(body) ? body : (body.models ?? [])
  return models.filter((model) => typeof model?.model_id === 'string')
}

/**
 * `/v2/voices` is the current endpoint and pages; `/v1/voices` returns
 * everything at once and is still served. Falling back covers keys whose
 * permissions or plan reject the v2 route.
 */
async function fetchVoices(apiKey: string): Promise<TtsVoice[]> {
  const headers = { 'xi-api-key': apiKey }

  let response = await fetch(`${BASE_URL}/v2/voices?page_size=100`, { headers })
  if (!response.ok) response = await fetch(`${BASE_URL}/v1/voices`, { headers })
  if (!response.ok) throw await upstreamError(response, 'models_fetch_failed')

  const body = (await response.json()) as { voices?: ElevenLabsVoice[] }
  return (body.voices ?? [])
    .filter((voice) => typeof voice?.voice_id === 'string')
    .map((voice) => ({ id: voice.voice_id, name: voice.name ?? voice.voice_id }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Maps an upstream failure onto our error vocabulary.
 *
 * ElevenLabs answers 401 both for a bad key and for an exhausted quota; the two
 * need different advice, so the machine-readable `detail.status` decides. A 401
 * never reaches the client as-is — the app reads that as an expired session.
 */
async function upstreamError(response: Response, fallbackCode: string): Promise<HttpError> {
  const raw = await response.text()
  let status: string | undefined
  let message = raw

  try {
    const parsed = JSON.parse(raw) as ElevenLabsError
    if (typeof parsed.detail === 'string') {
      message = parsed.detail
    } else if (parsed.detail) {
      status = parsed.detail.status
      message = parsed.detail.message ?? raw
    }
  } catch {
    // Not JSON: keep the raw body as the detail.
  }

  if (status === 'quota_exceeded') return new HttpError(402, 'tts_quota_exceeded', truncate(message))

  const rejectedKey =
    response.status === 401 ||
    response.status === 403 ||
    status === 'invalid_api_key' ||
    status === 'missing_permissions' ||
    status === 'detected_unusual_activity'
  if (rejectedKey) return new HttpError(403, 'invalid_api_key', truncate(message))

  return new HttpError(502, fallbackCode, truncate(`${response.status}: ${message}`))
}
