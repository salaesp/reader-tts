import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Player } from './player'
import { buildChunks, splitSentences } from './segmenter'

/**
 * jsdom has no media stack, so HTMLMediaElement is stubbed with a controllable
 * fake: playback position is set by the test and `timeupdate` dispatched by hand.
 */
function stubAudio(): { setPosition: (current: number, duration: number) => void } {
  let currentTime = 0
  let duration = 10

  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value
    },
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: () => duration,
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => false,
  })
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()

  return {
    setPosition(nextCurrent, nextDuration) {
      currentTime = nextCurrent
      duration = nextDuration
    },
  }
}

const TEXT =
  'Primera oración corta. Segunda oración un poco más larga que la anterior. Tercera y última oración.'

function makeChapter() {
  const sentences = splitSentences(TEXT, 'es')
  // A small target forces several sentences into one chunk.
  const chunks = buildChunks(sentences, 500)
  return { sentences, chunks }
}

describe('Player', () => {
  let audio: ReturnType<typeof stubAudio>

  beforeEach(() => {
    audio = stubAudio()
  })

  it('starts idle with no sentence highlighted', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const { sentences, chunks } = makeChapter()

    player.setChunks(chunks, sentences, 0)

    expect(player.getState()).toMatchObject({ status: 'idle', chunkIndex: 0, sentenceIndex: -1 })
    player.dispose()
  })

  it('clamps a resume position past the end of the chapter', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const { sentences, chunks } = makeChapter()

    player.setChunks(chunks, sentences, 99)

    expect(player.getState().chunkIndex).toBe(chunks.length - 1)
    player.dispose()
  })

  it('reports the chunk change when seeking', () => {
    const onChunkChange = vi.fn()
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1, onChunkChange })
    const sentences = splitSentences(TEXT, 'es')
    const chunks = buildChunks(sentences, 25)

    player.setChunks(chunks, sentences, 0)
    player.seekTo(1, false)

    expect(onChunkChange).toHaveBeenCalledWith(1)
    expect(player.getState().chunkIndex).toBe(1)
    player.dispose()
  })

  it('calls onChapterEnd when advancing past the last chunk', () => {
    const onChapterEnd = vi.fn()
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1, onChapterEnd })
    const { sentences, chunks } = makeChapter()

    player.setChunks(chunks, sentences, chunks.length - 1)
    player.next()

    expect(onChapterEnd).toHaveBeenCalled()
    player.dispose()
  })

  it('tracks the spoken sentence from the playback position', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const { sentences, chunks } = makeChapter()
    expect(chunks).toHaveLength(1)
    expect(sentences).toHaveLength(3)

    player.setChunks(chunks, sentences, 0)
    // Reach into the playing state without a real audio pipeline.
    const internals = player as unknown as {
      state: { status: string; sentenceIndex: number }
      audio: HTMLAudioElement
    }
    internals.state = { ...internals.state, status: 'playing' }

    const positions: number[] = []
    for (const fraction of [0.05, 0.5, 0.95]) {
      audio.setPosition(fraction * 10, 10)
      internals.audio.dispatchEvent(new Event('timeupdate'))
      positions.push(player.getState().sentenceIndex)
    }

    // Early, middle and late positions land on successive sentences.
    expect(positions[0]).toBe(0)
    expect(positions[1]).toBe(1)
    expect(positions[2]).toBe(2)
    player.dispose()
  })

  it('ignores position updates while not playing', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const { sentences, chunks } = makeChapter()
    player.setChunks(chunks, sentences, 0)

    audio.setPosition(5, 10)
    ;(player as unknown as { audio: HTMLAudioElement }).audio.dispatchEvent(new Event('timeupdate'))

    expect(player.getState().sentenceIndex).toBe(-1)
    player.dispose()
  })

  it('notifies subscribers and stops after unsubscribing', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const { sentences, chunks } = makeChapter()
    const listener = vi.fn()

    const unsubscribe = player.subscribe(listener)
    player.setChunks(chunks, sentences, 0)
    player.seekTo(0, false)
    const callsWhileSubscribed = listener.mock.calls.length

    unsubscribe()
    player.pause()

    expect(callsWhileSubscribed).toBeGreaterThan(0)
    expect(listener.mock.calls.length).toBe(callsWhileSubscribed)
    player.dispose()
  })

  it('applies the playback rate to the audio element', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })

    player.setRate(1.75)

    expect((player as unknown as { audio: HTMLAudioElement }).audio.playbackRate).toBe(1.75)
    player.dispose()
  })

  it('does nothing on play when there are no chunks', async () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })

    await player.play()

    expect(player.getState().status).toBe('idle')
    player.dispose()
  })
})

describe('Player.seekToSentence', () => {
  beforeEach(() => {
    stubAudio()
  })

  it('moves to the chunk containing the sentence', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const sentences = splitSentences(TEXT, 'es')
    const chunks = buildChunks(sentences, 25)

    player.seekToSentence(2, false)
    player.setChunks(chunks, sentences, 0)
    player.seekToSentence(2, false)

    const state = player.getState()
    expect(state.sentenceIndex).toBe(2)
    expect(chunks[state.chunkIndex].sentenceStart).toBeLessThanOrEqual(2)
    expect(chunks[state.chunkIndex].sentenceEnd).toBeGreaterThanOrEqual(2)
    player.dispose()
  })

  it('ignores a sentence index outside the chapter', () => {
    const player = new Player(null, { bookId: 'b1', lang: 'es', rate: 1 })
    const { sentences, chunks } = makeChapter()
    player.setChunks(chunks, sentences, 0)

    player.seekToSentence(999, false)

    expect(player.getState().sentenceIndex).toBe(-1)
    player.dispose()
  })
})

/**
 * Reproduces the mobile case: the element reports no duration until playback
 * has begun. Waiting for it before playing meant the seek was skipped and the
 * chunk started from the top — several sentences before the one tapped.
 */
function stubAudioWithLateMetadata(): {
  element: () => HTMLMediaElement | null
  announceDuration: (seconds: number) => void
  currentTime: () => number
} {
  let currentTime = 0
  let duration = Number.NaN
  let element: HTMLMediaElement | null = null

  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value
    },
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: () => duration,
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => (Number.isNaN(duration) ? 0 : 1),
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => false,
  })
  window.HTMLMediaElement.prototype.pause = vi.fn()
  window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    element = this
    return Promise.resolve()
  })

  return {
    element: () => element,
    announceDuration(seconds) {
      duration = seconds
      element?.dispatchEvent(new Event('loadedmetadata'))
    },
    currentTime: () => currentTime,
  }
}

describe('Player seeking into a chunk when metadata arrives late', () => {
  const engine = {
    provider: 'openrouter' as const,
    kind: 'cloud' as const,
    hash: () => Promise.resolve('h'),
    synthesize: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])])),
  }

  it('applies the jump once the duration is known, not before playing', async () => {
    const media = stubAudioWithLateMetadata()
    const { sentences, chunks } = makeChapter()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const player = new Player(engine as any, { bookId: 'b1', lang: 'es', rate: 1 })
    player.setChunks(chunks, sentences, 0)

    // The last sentence of the chunk, i.e. well past its start.
    const target = chunks[0].sentenceEnd
    player.seekToSentence(target)
    await vi.waitFor(() => expect(media.element()).not.toBeNull())

    // No duration yet, so nothing could have been positioned.
    expect(media.currentTime()).toBe(0)

    media.announceDuration(30)

    // Now it lands past the top of the chunk rather than starting from it.
    expect(media.currentTime()).toBeGreaterThan(0)
    player.dispose()
  })
})
