import type { TtsRequest } from '../../../shared/types'
import { isTtsProvider } from '../../../shared/types'
import type { Api } from '../../lib/env'
import { HttpError, json, readJson, requireUser } from '../../lib/http'
import {
  audioFormatOf,
  getApiKeyFromRow,
  loadSettingsRow,
  modelOf,
  providerOf,
  rememberAudioFormat,
  voiceOf,
} from '../../lib/settings'
import { clientFor } from '../../lib/tts'

const MAX_TEXT_LENGTH = 4000

/**
 * Synthesizes one chunk of text with the user's selected provider.
 *
 * The provider key never reaches the browser: it is decrypted here, used for
 * the upstream call, and the audio is streamed back.
 *
 * Renderings are not cached server-side. The browser keeps every chunk in
 * IndexedDB under the same hash, which covers re-listening on the device that
 * generated it; the only cost of dropping the server copy is paying the
 * provider again when the same passage is played on a second device.
 */
export const onRequestPost: Api = async ({ request, env, data }) => {
  const user = requireUser(data.user)
  const body = await readJson<TtsRequest>(request)

  const text = (body.text ?? '').trim()
  if (!text) throw new HttpError(400, 'missing_text')
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(413, 'text_too_long')
  if (!/^[a-f0-9]{64}$/.test(body.hash ?? '')) throw new HttpError(400, 'invalid_hash')

  const settings = await loadSettingsRow(env, user.id)
  // The request may name a provider so a "test voice" can target one that is
  // not the saved default; otherwise the stored selection wins.
  const provider = isTtsProvider(body.provider) ? body.provider : providerOf(settings)
  const model = body.model?.trim() || modelOf(settings, provider)
  const voice = body.voice?.trim() || voiceOf(settings, provider)

  const apiKey = await getApiKeyFromRow(env, settings, provider)
  if (!apiKey) throw new HttpError(412, 'no_api_key')

  const knownFormat = audioFormatOf(settings, provider)
  const result = await clientFor(provider).synthesize({
    apiKey,
    model,
    voice,
    text,
    origin: new URL(request.url).origin,
    format: knownFormat,
  })

  if (result.audio.byteLength === 0) throw new HttpError(502, 'tts_empty_response')

  // Discovering that this model needs pcm costs a rejected mp3 attempt; write
  // it down so the next chunk — and the two being prefetched — skip the probe.
  if (provider === 'openrouter' && result.format !== knownFormat) {
    await rememberAudioFormat(env, user.id, result.format)
  }

  return new Response(result.audio, {
    headers: {
      'content-type': result.contentType,
      'content-length': String(result.audio.byteLength),
      'cache-control': 'private, max-age=31536000, immutable',
      'x-generation-id': result.generationId,
    },
  })
}

export const onRequestGet: Api = () => json({ error: 'method_not_allowed' }, { status: 405 })
