import type { TtsRequest } from '../../../shared/types'
import { DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } from '../../../shared/types'
import type { Api } from '../../lib/env'
import { HttpError, json, readJson, requireUser } from '../../lib/http'
import { getApiKey, loadSettingsRow } from '../../lib/settings'

const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech'
const MAX_TEXT_LENGTH = 4000

/**
 * Synthesizes one chunk of text.
 *
 * The OpenRouter key never reaches the browser: it is decrypted here, used for
 * the upstream call, and the audio is streamed back. Renderings are cached in
 * R2 so re-listening to a chapter costs nothing.
 */
export const onRequestPost: Api = async ({ request, env, data, waitUntil }) => {
  const user = requireUser(data.user)
  const body = await readJson<TtsRequest>(request)

  const text = (body.text ?? '').trim()
  if (!text) throw new HttpError(400, 'missing_text')
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(413, 'text_too_long')
  if (!/^[a-f0-9]{64}$/.test(body.hash ?? '')) throw new HttpError(400, 'invalid_hash')

  const settings = await loadSettingsRow(env, user.id)
  const model = body.model?.trim() || settings.tts_model || DEFAULT_TTS_MODEL
  const voice = body.voice?.trim() || settings.tts_voice || DEFAULT_TTS_VOICE

  const scope = sanitizeSegment(body.bookId) ?? 'misc'
  const cacheKey = `audio/${user.id}/${scope}/${body.hash}.mp3`

  const cached = await env.BUCKET.get(cacheKey)
  if (cached) {
    return new Response(cached.body, {
      headers: {
        'content-type': 'audio/mpeg',
        'content-length': String(cached.size),
        'cache-control': 'private, max-age=31536000, immutable',
        'x-cache': 'HIT',
      },
    })
  }

  const apiKey = await getApiKey(env, user.id)
  if (!apiKey) throw new HttpError(412, 'no_api_key')

  const upstream = await fetch(OPENROUTER_SPEECH_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': new URL(request.url).origin,
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
      truncate(detail, 500),
    )
  }

  const audio = await upstream.arrayBuffer()
  if (audio.byteLength === 0) throw new HttpError(502, 'tts_empty_response')

  const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg'
  waitUntil(
    env.BUCKET.put(cacheKey, audio, { httpMetadata: { contentType } }).catch((err: unknown) => {
      console.error('failed to cache audio', err)
    }),
  )

  return new Response(audio, {
    headers: {
      'content-type': contentType,
      'content-length': String(audio.byteLength),
      'cache-control': 'private, max-age=31536000, immutable',
      'x-cache': 'MISS',
      'x-generation-id': upstream.headers.get('x-generation-id') ?? '',
    },
  })
}

/** Keeps a client-supplied id from escaping its prefix in the bucket. */
function sanitizeSegment(value: string | undefined): string | null {
  if (!value) return null
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export const onRequestGet: Api = () => json({ error: 'method_not_allowed' }, { status: 405 })
