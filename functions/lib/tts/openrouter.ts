import type { AudioFormat, TtsModel, TtsVoice, VoiceSource } from '../../../shared/types'
import { inferVoices } from '../../../shared/types'
import { HttpError } from '../http'
import type { SynthesisRequest, SynthesisResult, TtsProviderClient } from './types'
import { truncate } from './types'
import { findVoices } from './voices'
import { parsePcmFormat, pcmToWav } from './wav'

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
  /**
   * Voices are not in the documented schema and their location varies, so the
   * whole entry is handed to findVoices rather than one field being read.
   */
  [key: string]: unknown
}

export const openRouter: TtsProviderClient = {
  /**
   * `response_format` is not a free choice: mp3 is the compact one and most
   * providers serve it, but the Gemini TTS line only emits PCM and answers a
   * request for mp3 with a bare "Provider returned 400" — no hint as to which
   * field was the problem.
   *
   * So mp3 is attempted first and a rejection retries as PCM, which is then
   * wrapped in a WAV container because <audio> cannot play raw samples. The
   * caller passes the format that worked last time, so the wasted attempt
   * happens once per model rather than once per chunk.
   */
  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    // The speech endpoint requires a voice, and voices are namespaced per
    // provider. An empty one means the model changed and no voice has been
    // chosen for it yet — worth saying, rather than spending a call to be told
    // "Provider returned 400".
    if (!request.voice) throw new HttpError(400, 'no_voice_selected')

    const preferred = request.format === 'pcm' ? 'pcm' : 'mp3'

    try {
      return await speak(request, preferred)
    } catch (err) {
      const worthRetrying =
        preferred === 'mp3' && err instanceof HttpError && err.code === 'tts_failed'
      if (!worthRetrying) throw err
      return speak(request, 'pcm')
    }
  },

  async listModels(apiKey: string | null): Promise<TtsModel[]> {
    const body = await fetchModels(apiKey)
    return (body.data ?? [])
      .filter(producesAudio)
      .map(describeModel)
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  /**
   * Voices for one model, at the cost of a second request.
   *
   * The catalogue leaves `supported_voices` null for most models but hands out
   * a per-model `links.details` pointing at its endpoints, where the providers
   * describe what they actually accept. Doing this for the whole catalogue
   * would be one request per model; doing it for the selected one is one
   * request, made when Settings needs an answer.
   */
  async listVoices(apiKey: string | null, modelId: string): Promise<TtsVoice[]> {
    const body = await fetchModels(apiKey)
    const model = (body.data ?? []).find((entry) => entry.id === modelId)
    if (!model) return []

    const published = findVoices(model)
    if (published.length > 0) return published

    const response = await fetch(new URL(detailsPath(model), 'https://openrouter.ai'), {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit)
    // No voices published is a normal answer, not a failure: the caller falls
    // back to inference and to a free text field.
    if (!response.ok) return []

    return findVoices(await response.json())
  },

  async rawModels(apiKey: string | null, limit: number): Promise<unknown> {
    const body = await fetchModels(apiKey)
    return (body.data ?? []).filter(producesAudio).slice(0, limit)
  },
}

/** The catalogue supplies this link; the fallback mirrors how it is built. */
function detailsPath(model: OpenRouterModel): string {
  const links = model.links
  if (links !== null && typeof links === 'object') {
    const details = (links as { details?: unknown }).details
    if (typeof details === 'string' && details) return details
  }
  const slug = typeof model.canonical_slug === 'string' ? model.canonical_slug : model.id
  return `/api/v1/models/${slug}/endpoints`
}

async function fetchModels(apiKey: string | null): Promise<{ data?: OpenRouterModel[] }> {
  const response = await fetch(MODELS_URL, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit)

  if (!response.ok) {
    throw new HttpError(502, 'models_fetch_failed', `upstream status ${response.status}`)
  }
  return (await response.json()) as { data?: OpenRouterModel[] }
}

async function speak(
  { apiKey, model, voice, text, origin }: SynthesisRequest,
  responseFormat: AudioFormat,
): Promise<SynthesisResult> {
  const upstream = await fetch(SPEECH_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': origin,
      'x-title': 'Reader TTS',
    },
    body: JSON.stringify({ model, input: text, voice, response_format: responseFormat }),
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

  const body = await upstream.arrayBuffer()
  const contentType = upstream.headers.get('content-type') ?? ''
  const generationId = upstream.headers.get('x-generation-id') ?? ''

  if (responseFormat === 'pcm') {
    return {
      audio: pcmToWav(body, parsePcmFormat(contentType)),
      contentType: 'audio/wav',
      generationId,
      format: 'pcm',
    }
  }

  return { audio: body, contentType: contentType || 'audio/mpeg', generationId, format: 'mp3' }
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

/**
 * Prefers the voices OpenRouter publishes for the model and only guesses when
 * it publishes none. Guessing was the whole problem: `Kore` inferred from a
 * `google/` prefix is right, but the same trick offers nothing for Voxtral or
 * Kokoro and there is no signal that the resulting 400 was about the voice.
 */
function describeModel(model: OpenRouterModel): TtsModel {
  const published = findVoices(model)
  const voices = published.length > 0 ? published : inferVoices(model.id)

  let voiceSource: VoiceSource = 'unknown'
  if (published.length > 0) voiceSource = 'provider'
  else if (voices.length > 0) voiceSource = 'inferred'

  const pricing = model.pricing as Record<string, string> | undefined

  return {
    id: model.id,
    name: model.name ?? model.id,
    voices,
    voiceSource,
    pricing: pricing?.audio ?? pricing?.completion ?? null,
  }
}
