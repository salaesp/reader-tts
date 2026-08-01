import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../http'
import { openRouter } from './openrouter'

const BASE = {
  apiKey: 'sk-or-v1-test',
  model: 'google/gemini-3.1-flash-tts-preview',
  voice: 'Kore',
  text: 'Hola',
  origin: 'https://example.test',
}

function audio(contentType: string, bytes = [1, 2, 3, 4]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': contentType, 'x-generation-id': 'gen-1' },
  })
}

/** What OpenRouter answers when the upstream provider rejects the request. */
function providerRejection(): Response {
  return new Response(JSON.stringify({ error: { message: 'Provider returned 400', code: 400 } }), {
    status: 400,
  })
}

function mockFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentFormat(fetchMock: ReturnType<typeof vi.fn>, call: number): string {
  return JSON.parse(fetchMock.mock.calls[call][1].body).response_format
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openRouter.synthesize', () => {
  it('asks for mp3 and passes the bytes straight through', async () => {
    const fetchMock = mockFetch(audio('audio/mpeg'))

    const result = await openRouter.synthesize(BASE)

    expect(sentFormat(fetchMock, 0)).toBe('mp3')
    expect(result.format).toBe('mp3')
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.audio.byteLength).toBe(4)
  })

  // The Gemini line only emits pcm and answers a request for mp3 with a bare
  // "Provider returned 400" — nothing identifies response_format as the cause,
  // so the retry is the only way to find out.
  it('retries as pcm when the provider rejects mp3', async () => {
    const fetchMock = mockFetch(providerRejection(), audio('audio/pcm; rate=24000'))

    const result = await openRouter.synthesize(BASE)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentFormat(fetchMock, 0)).toBe('mp3')
    expect(sentFormat(fetchMock, 1)).toBe('pcm')
    expect(result.format).toBe('pcm')
    // Wrapped in WAV: raw samples are unplayable in an <audio> element.
    expect(result.contentType).toBe('audio/wav')
    expect(result.audio.byteLength).toBe(44 + 4)
  })

  it('skips the rejected attempt when pcm is already known to work', async () => {
    const fetchMock = mockFetch(audio('audio/pcm'))

    const result = await openRouter.synthesize({ ...BASE, format: 'pcm' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentFormat(fetchMock, 0)).toBe('pcm')
    expect(result.format).toBe('pcm')
  })

  it('gives up when pcm is rejected too, keeping the provider message', async () => {
    mockFetch(providerRejection(), providerRejection())

    await expect(openRouter.synthesize(BASE)).rejects.toMatchObject({
      status: 502,
      code: 'tts_failed',
    })
  })

  // Retrying a rejected key as pcm would just burn a second call.
  it('does not retry a rejected key', async () => {
    const fetchMock = mockFetch(new Response('no', { status: 401 }))

    const err = await openRouter.synthesize(BASE).catch((e: unknown) => e)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(403)
    expect((err as HttpError).code).toBe('invalid_api_key')
  })
})

describe('openRouter.synthesize without a voice', () => {
  it('says so instead of spending a call to be told "Provider returned 400"', async () => {
    const fetchMock = mockFetch(audio('audio/mpeg'))

    const err = await openRouter.synthesize({ ...BASE, voice: '' }).catch((e: unknown) => e)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
    expect((err as HttpError).code).toBe('no_voice_selected')
  })
})

describe('openRouter.listModels pricing', () => {
  // The shape OpenRouter really returns for a speech model: the cost is in
  // `prompt`, and `completion` is "0". Reading completion — as this used to —
  // advertised paid models as free.
  const catalogue = {
    data: [
      {
        id: 'fish-audio/s1',
        name: 'Fish Audio: S1',
        architecture: { modality: 'text->speech', output_modalities: ['speech'] },
        pricing: { prompt: '0.000015', completion: '0' },
        supported_voices: null,
      },
      {
        id: 'free/model',
        name: 'Free',
        architecture: { output_modalities: ['speech'] },
        pricing: { prompt: '0', completion: '0' },
      },
    ],
  }

  it('bills on the input price, not the completion price', async () => {
    mockFetch(new Response(JSON.stringify(catalogue), { status: 200 }))

    const models = await openRouter.listModels('sk-or-v1-test')

    expect(models.find((m) => m.id === 'fish-audio/s1')?.pricing).toEqual({
      input: 0.000015,
      output: 0,
    })
    expect(models.find((m) => m.id === 'free/model')?.pricing).toEqual({ input: 0, output: 0 })
  })

  it('marks a model with a null supported_voices as not having published any', async () => {
    mockFetch(new Response(JSON.stringify(catalogue), { status: 200 }))

    const models = await openRouter.listModels('sk-or-v1-test')

    expect(models.find((m) => m.id === 'fish-audio/s1')?.voiceSource).toBe('unknown')
  })
})
