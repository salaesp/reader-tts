import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { DOWNLOAD_CONCURRENCY, downloadChunks } from './download'
import { buildChunks, splitSentences } from './segmenter'
import { store } from './store'
import { MissingApiKeyError } from './tts'
import type { CloudTtsEngine } from './tts'

function chapter(sentences = 8) {
  const text = Array.from({ length: sentences }, (_, i) => `Oración número ${i} del capítulo.`).join(
    ' ',
  )
  return buildChunks(splitSentences(text, 'es'), 40)
}

/**
 * A stand-in for CloudTtsEngine. The real one writes to IndexedDB, which is
 * stubbed separately — what matters here is which chunks it is asked for.
 */
function fakeEngine(behaviour: (text: string, call: number) => Promise<Blob> = async () => blob()) {
  let calls = 0
  let inFlight = 0
  let peak = 0

  const engine = {
    hash: (text: string) => Promise.resolve(`hash:${text}`),
    async synthesize(text: string, _ctx: unknown, signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      inFlight++
      peak = Math.max(peak, inFlight)
      try {
        return await behaviour(text, calls++)
      } finally {
        inFlight--
      }
    },
  }

  return { engine: engine as unknown as CloudTtsEngine, peak: () => peak, calls: () => calls }
}

function blob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])])
}

/** Chunks the cache claims to hold once the run is over. */
let stored: Set<string>

beforeEach(() => {
  stored = new Set()
  vi.spyOn(store, 'cachedHashes').mockImplementation(() => Promise.resolve(new Set(stored)))
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Marks everything as landing in the cache, the ordinary case. */
function everythingStores(chunks: { text: string }[]) {
  for (const chunk of chunks) stored.add(`hash:${chunk.text}`)
}

const base = { bookId: 'b1', lang: 'es' as const }

describe('downloadChunks', () => {
  it('renders every chunk and reports progress as it goes', async () => {
    const chunks = chapter()
    const { engine, calls } = fakeEngine()
    const seen: number[] = []

    const result = await downloadChunks({
      ...base,
      engine,
      chunks,
      onProgress: (p) => {
        everythingStores(chunks)
        seen.push(p.done)
      },
    })

    expect(calls()).toBe(chunks.length)
    expect(result.done).toBe(chunks.length)
    expect(result.failed).toBe(0)
    expect(result.stoppedBy).toBeNull()
    expect(seen.at(-1)).toBe(chunks.length)
  })

  it('never runs more than the concurrency limit at once', async () => {
    const chunks = chapter(20)
    const { engine, peak } = fakeEngine(
      () => new Promise((resolve) => setTimeout(() => resolve(blob()), 5)),
    )

    await downloadChunks({ ...base, engine, chunks, onProgress: () => everythingStores(chunks) })

    expect(peak()).toBeLessThanOrEqual(DOWNLOAD_CONCURRENCY)
    expect(peak()).toBeGreaterThan(1)
  })

  it('skips what the cache already holds, so progress counts real work', async () => {
    const chunks = chapter()
    stored.add(`hash:${chunks[0].text}`)
    const { engine, calls } = fakeEngine()

    const result = await downloadChunks({
      ...base,
      engine,
      chunks,
      onProgress: () => everythingStores(chunks),
    })

    expect(result.total).toBe(chunks.length - 1)
    expect(calls()).toBe(chunks.length - 1)
  })

  it('does nothing at all when the chapter is already downloaded', async () => {
    const chunks = chapter()
    everythingStores(chunks)
    const { engine, calls } = fakeEngine()

    const result = await downloadChunks({ ...base, engine, chunks })

    expect(calls()).toBe(0)
    expect(result).toMatchObject({ done: 0, failed: 0, total: 0, stoppedBy: null })
  })

  // One bad chunk is not a reason to abandon the chapter.
  it('keeps going past a single failure and counts it', async () => {
    const chunks = chapter()
    const { engine } = fakeEngine(async (text) => {
      if (text === chunks[1].text) throw new ApiError(400, 'tts_failed')
      return blob()
    })

    const result = await downloadChunks({
      ...base,
      engine,
      chunks,
      onProgress: () => everythingStores(chunks),
    })

    expect(result.failed).toBe(1)
    expect(result.done).toBe(chunks.length - 1)
    expect(result.stoppedBy).toBeNull()
  })

  // Every remaining chunk would fail the same way, and each failure is a paid
  // round trip.
  it.each([
    ['an exhausted quota', new ApiError(402, 'tts_quota_exceeded'), 'quota_exceeded'],
    ['a rejected key', new ApiError(403, 'invalid_api_key'), 'invalid_api_key'],
    ['a missing key', new MissingApiKeyError(), 'no_api_key'],
  ])('stops the whole run on %s', async (_label, error, expected) => {
    const chunks = chapter(20)
    const { engine, calls } = fakeEngine(async () => {
      throw error
    })

    const result = await downloadChunks({ ...base, engine, chunks })

    expect(result.stoppedBy).toBe(expected)
    // At most one per worker before they all notice.
    expect(calls()).toBeLessThanOrEqual(DOWNLOAD_CONCURRENCY)
    expect(result.error).toBe(error)
  })

  it('retries once on a network blip, then succeeds', async () => {
    const chunks = chapter(2)
    let thrown = false
    const { engine, calls } = fakeEngine(async () => {
      if (!thrown) {
        thrown = true
        throw new ApiError(0, 'network_error')
      }
      return blob()
    })

    const result = await downloadChunks({
      ...base,
      engine,
      chunks,
      onProgress: () => everythingStores(chunks),
    })

    expect(calls()).toBe(chunks.length + 1)
    expect(result.done).toBe(chunks.length)
    expect(result.failed).toBe(0)
  })

  it('stops calling once cancelled', async () => {
    const chunks = chapter(20)
    const controller = new AbortController()
    const { engine, calls } = fakeEngine(async (_text, call) => {
      if (call === 1) controller.abort()
      return blob()
    })

    const result = await downloadChunks({
      ...base,
      engine,
      chunks,
      signal: controller.signal,
      onProgress: () => everythingStores(chunks),
    })

    expect(result.cancelled).toBe(true)
    expect(calls()).toBeLessThan(chunks.length)
  })

  // Synthesis succeeded, so the audio was paid for — but a full quota rejects
  // the write and there is nothing on the device to play.
  it('reports storage that silently refused the writes', async () => {
    const chunks = chapter(4)
    const { engine } = fakeEngine()

    const result = await downloadChunks({ ...base, engine, chunks })

    expect(result.stoppedBy).toBe('storage_full')
    expect(result.done).toBe(0)
    expect(result.failed).toBe(chunks.length)
  })
})
