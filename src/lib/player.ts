import type { ReadingLang } from '../../shared/types'
import type { Chunk, Sentence } from './segmenter'
import { ApiError } from './api'
import { BrowserVoiceEngine, CloudTtsEngine, MissingApiKeyError, browserVoiceAvailable } from './tts'

/**
 * Drives playback of a chapter's chunks.
 *
 * Chunks are rendered ahead of time (PREFETCH_AHEAD of them) so the gap between
 * one chunk and the next is inaudible. The player owns a single HTMLAudioElement
 * for its whole lifetime, which matters on iOS: an element may only start
 * playing as a direct result of a user gesture, so it is unlocked once on the
 * first tap and then reused for every later chunk.
 */

const PREFETCH_AHEAD = 2

/** A 0.05s silent MP3, used to unlock audio playback on the first gesture. */
const SILENT_MP3 =
  'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA//////////////////////////////////////////////////////////////////8AAAA5TEFNRTMuMTAwAc0AAAAAAAAAABSAJAJAQgAAgAAAAnGMUXVVAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV'

export type PlayerStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlayerError {
  code: string
  detail?: string
}

export interface PlayerState {
  status: PlayerStatus
  chunkIndex: number
  /**
   * Sentence currently being spoken, or -1 when nothing is playing. Highlighting
   * a whole chunk would light up several paragraphs at once, so the position is
   * tracked at sentence granularity: exactly from boundary events when the
   * browser voice reports them, estimated from playback position otherwise.
   */
  sentenceIndex: number
  error: PlayerError | null
  /** True once a provider failure pushed playback onto the browser voice. */
  usingFallback: boolean
  /**
   * Why the fallback kicked in. Kept apart from `error` because playback did
   * not actually stop — but without it a provider that rejects every request
   * looks like nothing more than "using the browser voice", which hides the
   * one piece of information needed to fix it.
   */
  fallbackReason: PlayerError | null
}

/** Character span of one sentence inside its chunk's text. */
interface SentenceSpan {
  index: number
  start: number
  end: number
}

export interface PlayerOptions {
  bookId: string
  lang: ReadingLang
  rate: number
  /** Fires whenever the active chunk changes, for highlighting and progress. */
  onChunkChange?: (chunkIndex: number) => void
  /** Fires after the final chunk of the chapter finishes playing. */
  onChapterEnd?: () => void
}

type Listener = (state: PlayerState) => void

export class Player {
  private chunks: Chunk[] = []
  private sentences: Sentence[] = []
  private state: PlayerState = {
    status: 'idle',
    chunkIndex: 0,
    sentenceIndex: -1,
    error: null,
    usingFallback: false,
    fallbackReason: null,
  }

  private readonly audio: HTMLAudioElement
  private readonly listeners = new Set<Listener>()
  private readonly prefetches = new Map<number, Promise<Blob>>()
  private readonly browserEngine = new BrowserVoiceEngine()

  private engine: CloudTtsEngine | null
  private options: PlayerOptions
  private unlocked = false
  private disposed = false
  /** Aborts the in-flight synthesis or utterance when the user moves away. */
  private playbackController: AbortController | null = null
  /** Guards against a stale async continuation resuming after a seek. */
  private generation = 0
  private objectUrl: string | null = null
  /** Sentence to start from once the chunk's audio is ready. */
  private pendingSentence: number | null = null

  constructor(engine: CloudTtsEngine | null, options: PlayerOptions) {
    this.engine = engine
    this.options = options

    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.playbackRate = options.rate
    this.audio.addEventListener('ended', this.handleEnded)
    this.audio.addEventListener('error', this.handleAudioError)
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate)
  }

  // --- subscription -------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): PlayerState => this.state

  private setState(patch: Partial<PlayerState>): void {
    const next = { ...this.state, ...patch }
    if (
      next.status === this.state.status &&
      next.chunkIndex === this.state.chunkIndex &&
      next.sentenceIndex === this.state.sentenceIndex &&
      next.error === this.state.error &&
      next.usingFallback === this.state.usingFallback &&
      next.fallbackReason === this.state.fallbackReason
    ) {
      return
    }
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  // --- configuration ------------------------------------------------------

  setChunks(chunks: Chunk[], sentences: Sentence[], startIndex = 0): void {
    this.stopPlayback()
    this.chunks = chunks
    this.sentences = sentences
    this.pendingSentence = null
    this.prefetches.clear()
    this.setState({
      status: 'idle',
      chunkIndex: Math.min(Math.max(0, startIndex), Math.max(0, chunks.length - 1)),
      sentenceIndex: -1,
      error: null,
    })
  }

  /**
   * Character spans of each sentence within a chunk's text. The chunk text is
   * its sentences joined by a single space, so the spans follow from the
   * sentence lengths without re-parsing anything.
   */
  private sentenceSpans(chunk: Chunk): SentenceSpan[] {
    const spans: SentenceSpan[] = []
    let cursor = 0
    for (let index = chunk.sentenceStart; index <= chunk.sentenceEnd; index++) {
      const sentence = this.sentences[index]
      if (!sentence) break
      spans.push({ index, start: cursor, end: cursor + sentence.text.length })
      cursor += sentence.text.length + 1
    }
    return spans
  }

  private sentenceAtChar(chunk: Chunk, charIndex: number): number {
    const spans = this.sentenceSpans(chunk)
    if (spans.length === 0) return -1
    for (const span of spans) {
      if (charIndex < span.end) return span.index
    }
    return spans[spans.length - 1].index
  }

  /**
   * Estimates the spoken sentence from playback position. Speech is close
   * enough to constant-rate within a chunk that proportional mapping keeps the
   * highlight on the right sentence.
   */
  private handleTimeUpdate = (): void => {
    if (this.state.status !== 'playing') return
    const chunk = this.chunks[this.state.chunkIndex]
    if (!chunk) return

    const { currentTime, duration } = this.audio
    if (!Number.isFinite(duration) || duration <= 0) return

    const spans = this.sentenceSpans(chunk)
    const totalChars = spans.length > 0 ? spans[spans.length - 1].end : 0
    if (totalChars === 0) return

    const sentenceIndex = this.sentenceAtChar(chunk, (currentTime / duration) * totalChars)
    if (sentenceIndex !== this.state.sentenceIndex) this.setState({ sentenceIndex })
  }

  /**
   * Swapping the engine clears the fallback: the user changing provider, model
   * or voice is exactly the fix for whatever pushed playback off the cloud.
   */
  setEngine(engine: CloudTtsEngine | null): void {
    this.engine = engine
    this.prefetches.clear()
    if (engine === null) return
    this.setState({ usingFallback: false, fallbackReason: null })
  }

  setOptions(options: Partial<PlayerOptions>): void {
    this.options = { ...this.options, ...options }
    if (options.rate !== undefined) this.audio.playbackRate = options.rate
  }

  setRate(rate: number): void {
    this.options.rate = rate
    this.audio.playbackRate = rate
  }

  /**
   * Must be called synchronously from a user gesture. Plays a silent clip so
   * the audio element is allowed to play programmatically from then on.
   */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.audio.src = SILENT_MP3
    void this.audio.play().catch(() => {
      // Autoplay policies vary; the real play() below reports any real problem.
    })
  }

  // --- transport ----------------------------------------------------------

  async play(): Promise<void> {
    if (this.chunks.length === 0) return
    if (this.state.status === 'playing') return
    await this.playChunk(this.state.chunkIndex)
  }

  pause(): void {
    this.stopPlayback()
    this.setState({ status: 'paused' })
  }

  toggle(): void {
    if (this.state.status === 'playing' || this.state.status === 'buffering') this.pause()
    else void this.play()
  }

  /** Jumps to a chunk. Resumes playing when playback was already running. */
  seekTo(chunkIndex: number, autoplay = this.state.status === 'playing'): void {
    const index = Math.min(Math.max(0, chunkIndex), Math.max(0, this.chunks.length - 1))
    this.pendingSentence = null
    this.stopPlayback()
    this.setState({
      chunkIndex: index,
      sentenceIndex: this.chunks[index]?.sentenceStart ?? -1,
      error: null,
      status: autoplay ? 'buffering' : 'paused',
    })
    this.options.onChunkChange?.(index)
    if (autoplay) void this.playChunk(index)
  }

  /**
   * Starts from a specific sentence. Audio is rendered per chunk, so playback
   * jumps into the middle of the chunk: the offset is derived from the
   * sentence's character position, the same mapping used for highlighting.
   */
  seekToSentence(sentenceIndex: number, autoplay = true): void {
    const chunkIndex = this.chunks.findIndex(
      (chunk) => sentenceIndex >= chunk.sentenceStart && sentenceIndex <= chunk.sentenceEnd,
    )
    if (chunkIndex < 0) return

    this.pendingSentence = sentenceIndex
    this.stopPlayback()
    this.setState({
      chunkIndex,
      sentenceIndex,
      error: null,
      status: autoplay ? 'buffering' : 'paused',
    })
    this.options.onChunkChange?.(chunkIndex)
    if (autoplay) void this.playChunk(chunkIndex)
    else this.pendingSentence = null
  }

  next(): void {
    if (this.state.chunkIndex >= this.chunks.length - 1) {
      this.options.onChapterEnd?.()
      return
    }
    this.seekTo(this.state.chunkIndex + 1)
  }

  previous(): void {
    this.seekTo(Math.max(0, this.state.chunkIndex - 1))
  }

  dispose(): void {
    this.disposed = true
    this.stopPlayback()
    this.audio.removeEventListener('ended', this.handleEnded)
    this.audio.removeEventListener('error', this.handleAudioError)
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate)
    this.audio.src = ''
    this.releaseObjectUrl()
    this.listeners.clear()
    this.prefetches.clear()
  }

  // --- playback -----------------------------------------------------------

  private async playChunk(index: number): Promise<void> {
    const chunk = this.chunks[index]
    if (!chunk) return

    this.stopPlayback()
    const controller = new AbortController()
    this.playbackController = controller
    const generation = ++this.generation

    this.setState({
      status: 'buffering',
      chunkIndex: index,
      // A pending seek already picked the sentence; otherwise start at the top.
      sentenceIndex: this.pendingSentence ?? chunk.sentenceStart,
      error: null,
    })
    this.options.onChunkChange?.(index)

    try {
      if (this.engine && !this.state.usingFallback) {
        const blob = await this.fetchChunk(index, controller.signal)
        if (this.isStale(generation)) return
        await this.playBlob(blob, chunk)
        if (this.isStale(generation)) return
        this.setState({ status: 'playing' })
        this.prefetchAhead(index)
      } else {
        // The browser voice can simply start from the sentence's text.
        const offset = this.pendingOffsetIn(chunk)
        this.pendingSentence = null
        await this.speakWithBrowser(chunk.text.slice(offset), controller.signal, generation, offset)
      }
    } catch (err) {
      if (this.isStale(generation) || isAbort(err)) return
      await this.handlePlaybackError(err, chunk.text, generation)
    }
  }

  /** Renders a chunk, reusing an in-flight prefetch when there is one. */
  private fetchChunk(index: number, signal: AbortSignal): Promise<Blob> {
    const existing = this.prefetches.get(index)
    if (existing) return existing

    const chunk = this.chunks[index]
    if (!chunk || !this.engine) return Promise.reject(new Error('nothing to render'))

    // Prefetches are deliberately not tied to `signal`: a chunk fetched for the
    // next position stays useful even if the current one is cancelled.
    const promise = this.engine
      .synthesize(chunk.text, { lang: this.options.lang, bookId: this.options.bookId }, signal)
      .catch((err: unknown) => {
        this.prefetches.delete(index)
        throw err
      })

    this.prefetches.set(index, promise)
    return promise
  }

  private prefetchAhead(index: number): void {
    if (!this.engine || this.state.usingFallback) return

    for (let offset = 1; offset <= PREFETCH_AHEAD; offset++) {
      const target = index + offset
      if (target >= this.chunks.length || this.prefetches.has(target)) continue
      const chunk = this.chunks[target]
      const promise = this.engine
        .synthesize(chunk.text, { lang: this.options.lang, bookId: this.options.bookId })
        .catch((err: unknown) => {
          this.prefetches.delete(target)
          // A failed prefetch is retried when playback reaches that chunk.
          throw err
        })
      this.prefetches.set(target, promise)
      // Nothing awaits this promise yet; swallow the rejection so it does not
      // surface as an unhandled rejection.
      void promise.catch(() => {})
    }

    // Keep only a small window of rendered audio in memory.
    for (const key of this.prefetches.keys()) {
      if (key < index) this.prefetches.delete(key)
    }
  }

  /** Character offset within the chunk that the pending sentence starts at. */
  private pendingOffsetIn(chunk: Chunk): number {
    if (this.pendingSentence === null) return 0
    const span = this.sentenceSpans(chunk).find((entry) => entry.index === this.pendingSentence)
    return span?.start ?? 0
  }

  private async playBlob(blob: Blob, chunk: Chunk): Promise<void> {
    this.releaseObjectUrl()
    this.objectUrl = URL.createObjectURL(blob)
    this.audio.src = this.objectUrl
    this.audio.playbackRate = this.options.rate

    const offset = this.pendingOffsetIn(chunk)
    this.pendingSentence = null

    if (offset > 0) {
      const spans = this.sentenceSpans(chunk)
      const totalChars = spans.length > 0 ? spans[spans.length - 1].end : 0
      if (totalChars > 0) await this.seekAudioTo(offset / totalChars)
    }

    await this.audio.play()
  }

  /** Positions the audio element once its duration is known. */
  private seekAudioTo(fraction: number): Promise<void> {
    return new Promise((resolve) => {
      const apply = (): void => {
        if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
          this.audio.currentTime = fraction * this.audio.duration
        }
        resolve()
      }
      if (this.audio.readyState >= 1) {
        apply()
        return
      }
      this.audio.addEventListener('loadedmetadata', apply, { once: true })
      // Never block playback on a metadata event that does not arrive.
      setTimeout(resolve, 2000)
    })
  }

  private async speakWithBrowser(
    text: string,
    signal: AbortSignal,
    generation: number,
    charOffset = 0,
  ): Promise<void> {
    if (!browserVoiceAvailable()) {
      this.setState({ status: 'error', error: { code: 'no_voice_available' } })
      return
    }
    await this.browserEngine.prepare()
    if (this.isStale(generation)) return

    const chunk = this.chunks[this.state.chunkIndex]
    this.setState({ status: 'playing' })

    await this.browserEngine.speak(text, {
      lang: this.options.lang,
      rate: this.options.rate,
      signal,
      // Boundary events give the exact character being spoken, which beats the
      // proportional estimate used for rendered audio.
      onBoundary: (charIndex) => {
        if (!chunk || this.isStale(generation)) return
        const sentenceIndex = this.sentenceAtChar(chunk, charOffset + charIndex)
        if (sentenceIndex !== this.state.sentenceIndex) this.setState({ sentenceIndex })
      },
    })
    if (this.isStale(generation)) return
    this.advance()
  }

  /**
   * A missing key or an unreachable network drops to the browser voice rather
   * than stopping the book; anything else surfaces to the user.
   */
  private async handlePlaybackError(
    err: unknown,
    text: string,
    generation: number,
  ): Promise<void> {
    const recoverable =
      err instanceof MissingApiKeyError ||
      (err instanceof ApiError && (err.code === 'network_error' || err.status >= 500))

    if (recoverable && browserVoiceAvailable() && !this.state.usingFallback) {
      this.setState({ usingFallback: true, fallbackReason: describeError(err) })
      this.prefetches.clear()
      const controller = new AbortController()
      this.playbackController = controller
      try {
        this.pendingSentence = null
        await this.speakWithBrowser(text, controller.signal, generation)
      } catch (fallbackErr) {
        if (!isAbort(fallbackErr) && !this.isStale(generation)) {
          this.setState({ status: 'error', error: describeError(fallbackErr) })
        }
      }
      return
    }

    this.setState({ status: 'error', error: describeError(err) })
  }

  private handleEnded = (): void => {
    // Ignore the unlock clip finishing.
    if (this.state.status !== 'playing') return
    this.advance()
  }

  private handleAudioError = (): void => {
    if (this.state.status !== 'playing' && this.state.status !== 'buffering') return
    if (!this.audio.src || this.audio.src === SILENT_MP3) return
    this.setState({ status: 'error', error: { code: 'audio_playback_failed' } })
  }

  private advance(): void {
    const nextIndex = this.state.chunkIndex + 1
    if (nextIndex >= this.chunks.length) {
      this.setState({ status: 'ended' })
      this.options.onChapterEnd?.()
      return
    }
    void this.playChunk(nextIndex)
  }

  private stopPlayback(): void {
    this.playbackController?.abort()
    this.playbackController = null
    this.browserEngine.stop()
    if (!this.audio.paused) this.audio.pause()
  }

  private isStale(generation: number): boolean {
    return this.disposed || generation !== this.generation
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function describeError(err: unknown): PlayerError {
  if (err instanceof MissingApiKeyError) return { code: 'no_api_key' }
  if (err instanceof ApiError) return { code: err.code, detail: err.detail }
  if (err instanceof Error) return { code: 'playback_failed', detail: err.message }
  return { code: 'playback_failed' }
}
