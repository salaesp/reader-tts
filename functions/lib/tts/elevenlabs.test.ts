import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../http'
import { elevenLabs } from './elevenlabs'

const BASE = { apiKey: 'sk_test', model: 'eleven_multilingual_v2', origin: 'https://example.test' }

function audioResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'request-id': 'req-1' },
  })
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Replaces global fetch with a queue of responses keyed by call order. */
function mockFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function expectHttpError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError)
    return err as HttpError
  }
  throw new Error('expected the call to reject')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('elevenLabs.synthesize', () => {
  it('posts the text to the voice endpoint and returns the audio', async () => {
    const fetchMock = mockFetch(audioResponse())

    const result = await elevenLabs.synthesize({ ...BASE, voice: 'voice-1', text: 'Hola' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128',
    )
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('sk_test')
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Hola',
      model_id: 'eleven_multilingual_v2',
    })
    expect(result.audio.byteLength).toBe(3)
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.generationId).toBe('req-1')
  })

  it('escapes the voice id instead of building a broken path', async () => {
    const fetchMock = mockFetch(audioResponse())

    await elevenLabs.synthesize({ ...BASE, voice: 'a/b', text: 'Hola' })

    expect(fetchMock.mock.calls[0][0]).toContain('/v1/text-to-speech/a%2Fb?')
  })

  it('rejects an empty voice before calling the API', async () => {
    const fetchMock = mockFetch(audioResponse())

    const err = await expectHttpError(elevenLabs.synthesize({ ...BASE, voice: '', text: 'Hola' }))

    expect(err.status).toBe(400)
    expect(err.code).toBe('no_voice_selected')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // A 401 passed through as-is reads to the client as an expired session and
  // bounces the user to the login screen.
  it('maps a rejected key to 403 invalid_api_key', async () => {
    mockFetch(errorResponse(401, { detail: { status: 'invalid_api_key', message: 'bad key' } }))

    const err = await expectHttpError(elevenLabs.synthesize({ ...BASE, voice: 'v', text: 'Hola' }))

    expect(err.status).toBe(403)
    expect(err.code).toBe('invalid_api_key')
    expect(err.detail).toBe('bad key')
  })

  it('tells an exhausted quota apart from a bad key', async () => {
    mockFetch(errorResponse(401, { detail: { status: 'quota_exceeded', message: 'out of credits' } }))

    const err = await expectHttpError(elevenLabs.synthesize({ ...BASE, voice: 'v', text: 'Hola' }))

    expect(err.status).toBe(402)
    expect(err.code).toBe('tts_quota_exceeded')
    expect(err.detail).toBe('out of credits')
  })

  it('surfaces a validation failure with the upstream message', async () => {
    mockFetch(errorResponse(422, { detail: 'model_id does not exist' }))

    const err = await expectHttpError(elevenLabs.synthesize({ ...BASE, voice: 'v', text: 'Hola' }))

    expect(err.status).toBe(502)
    expect(err.code).toBe('tts_failed')
    expect(err.detail).toContain('model_id does not exist')
  })

  it('keeps a non-JSON error body as the detail', async () => {
    mockFetch(new Response('gateway down', { status: 503 }))

    const err = await expectHttpError(elevenLabs.synthesize({ ...BASE, voice: 'v', text: 'Hola' }))

    expect(err.status).toBe(502)
    expect(err.detail).toContain('gateway down')
  })
})

describe('elevenLabs.listModels', () => {
  const models = [
    { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', can_do_text_to_speech: true },
    { model_id: 'scribe_v1', name: 'Scribe', can_do_text_to_speech: false },
  ]
  const voices = { voices: [{ voice_id: 'v2', name: 'Zoe' }, { voice_id: 'v1', name: 'Alba' }] }

  it('keeps only speech models and attaches the account voices', async () => {
    mockFetch(errorResponse(200, models), errorResponse(200, voices))

    const result = await elevenLabs.listModels('sk_test')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('eleven_multilingual_v2')
    // Sorted by name so the selector is not in arbitrary API order.
    expect(result[0].voices).toEqual([
      { id: 'v1', name: 'Alba' },
      { id: 'v2', name: 'Zoe' },
    ])
  })

  it('falls back to /v1/voices when /v2/voices is refused', async () => {
    const fetchMock = mockFetch(
      errorResponse(200, models),
      errorResponse(403, { detail: 'nope' }),
      errorResponse(200, voices),
    )

    const result = await elevenLabs.listModels('sk_test')

    expect(fetchMock.mock.calls[1][0]).toContain('/v2/voices')
    expect(fetchMock.mock.calls[2][0]).toContain('/v1/voices')
    expect(result[0].voices).toHaveLength(2)
  })

  it('reports a missing key without calling the API', async () => {
    const fetchMock = mockFetch()

    const err = await expectHttpError(elevenLabs.listModels(null))

    expect(err.status).toBe(412)
    expect(err.code).toBe('no_api_key')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
