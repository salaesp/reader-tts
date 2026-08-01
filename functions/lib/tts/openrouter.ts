import type { AudioFormat, TtsModel, TtsVoice } from '../../../shared/types'
import { HttpError } from '../http'
import type { SynthesisRequest, SynthesisResult, TtsProviderClient } from './types'
import { truncate } from './types'
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
  /** Not part of the documented schema; used when a provider advertises it. */
  voices?: unknown
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
