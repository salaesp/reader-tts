import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Book } from '../../shared/types'
import { PROVIDER_LABELS } from '../../shared/types'
import { useI18n } from '../i18n'
import { ApiError, api } from '../lib/api'
import { buildTextIndex, highlightSentences, wrapSentences } from '../lib/annotate'
import type { EpubBook, EpubChapter } from '../lib/epub'
import { openEpub } from '../lib/epub'
import { setMediaHandlers, setMediaMetadata, setPlaybackState } from '../lib/mediaSession'
import { Player } from '../lib/player'
import type { PlayerState } from '../lib/player'
import { ProgressSync, computePercent, mergeProgress } from '../lib/progress'
import { useRouter } from '../lib/router'
import type { Chunk, Sentence } from '../lib/segmenter'
import { buildChunks, splitSentences } from '../lib/segmenter'
import { useSession } from '../lib/session'
import { store } from '../lib/store'
import { CloudTtsEngine, browserVoiceAvailable } from '../lib/tts'
import { ChapterList } from '../components/ChapterList'
import { PlayerBar } from '../components/PlayerBar'
import { Banner, Button, Spinner } from '../components/ui'

interface ChapterState {
  index: number
  html: string
  sentences: Sentence[]
  chunks: Chunk[]
}

export default function Reader({ bookId }: { bookId: string }) {
  const { t } = useI18n()
  const { navigate } = useRouter()
  const { settings, updateSettings } = useSession()

  const [book, setBook] = useState<Book | null>(null)
  const [chapters, setChapters] = useState<EpubChapter[]>([])
  const [chapter, setChapter] = useState<ChapterState | null>(null)
  const [failedToLoad, setFailedToLoad] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showChapters, setShowChapters] = useState(false)
  const [sleepMinutes, setSleepMinutes] = useState(0)
  const [follow, setFollow] = useState(true)
  const [playerState, setPlayerState] = useState<PlayerState>({
    status: 'idle',
    chunkIndex: 0,
    sentenceIndex: -1,
    error: null,
    usingFallback: false,
    fallbackReason: null,
  })

  const epubRef = useRef<EpubBook | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const syncRef = useRef<ProgressSync | null>(null)
  const chapterRef = useRef<ChapterState | null>(null)
  const followRef = useRef(follow)
  const startPositionRef = useRef<{ chapterIndex: number; chunkIndex: number } | null>(null)
  /** Set when a chapter is loaded with the intent of continuing playback. */
  const autoplayRef = useRef(false)

  chapterRef.current = chapter
  followRef.current = follow

  const provider = settings.providers[settings.ttsProvider]
  const engine = useMemo(
    () =>
      settings.useBrowserVoice
        ? null
        : new CloudTtsEngine(settings.ttsProvider, provider.model, provider.voice),
    [settings.useBrowserVoice, settings.ttsProvider, provider.model, provider.voice],
  )

  // --- load the book ------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    const sync = new ProgressSync(bookId)
    syncRef.current = sync

    void (async () => {
      setLoading(true)
      setFailedToLoad(false)

      try {
        // Metadata: prefer the server, fall back to the offline copy.
        let meta: Book | null = null
        let remoteProgress = null
        try {
          const { book: fetched } = await api.getBook(bookId)
          meta = fetched
          remoteProgress = fetched.progress
        } catch (err) {
          if (err instanceof ApiError && err.isUnauthorized) throw err
          meta = (await store.getBook(bookId)) ?? null
        }
        if (!meta) throw new Error('book not found')
        if (cancelled) return
        setBook(meta)

        // Bytes: the local copy avoids re-downloading on every open.
        let file = await store.getFile(bookId)
        if (!file) {
          file = await api.downloadBook(bookId)
          void store.saveFile(bookId, file)
        }
        if (cancelled) return

        const epub = await openEpub(file)
        if (cancelled) {
          epub.dispose()
          return
        }
        epubRef.current = epub
        setChapters(epub.chapters)

        const local = await store.getProgress(bookId)
        const resume = mergeProgress(local, remoteProgress)
        startPositionRef.current = {
          chapterIndex: Math.min(resume?.chapterIndex ?? 0, epub.chapters.length - 1),
          chunkIndex: resume?.chunkIndex ?? 0,
        }

        await loadChapter(startPositionRef.current.chapterIndex)
      } catch (err) {
        console.error('failed to open book', err)
        if (!cancelled) setFailedToLoad(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      void sync.flush()
      sync.dispose()
      playerRef.current?.dispose()
      playerRef.current = null
      epubRef.current?.dispose()
      epubRef.current = null
    }
    // Only the book identity should tear this down and reload: translations and
    // loadChapter change for reasons that must not restart the whole book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  // --- chapter loading ----------------------------------------------------

  const loadChapter = useCallback(
    async (index: number): Promise<void> => {
      const epub = epubRef.current
      if (!epub) return

      const { html } = await epub.loadChapter(index)

      // Sentences are derived from the DOM that will actually be rendered, so
      // every offset lines up with a node we can highlight.
      const scratch = document.createElement('div')
      scratch.innerHTML = html
      const textIndex = buildTextIndex(scratch)
      const sentences = splitSentences(textIndex.text, settings.readingLang)
      wrapSentences(textIndex, sentences)

      const chunks = buildChunks(sentences)
      setChapter({ index, html: scratch.innerHTML, sentences, chunks })
    },
    [settings.readingLang],
  )

  // --- player wiring ------------------------------------------------------

  useEffect(() => {
    if (!chapter || !book) return

    const startChunk =
      startPositionRef.current?.chapterIndex === chapter.index
        ? Math.min(startPositionRef.current.chunkIndex, Math.max(0, chapter.chunks.length - 1))
        : 0
    startPositionRef.current = null

    const handlers = {
      lang: settings.readingLang,
      onChunkChange: (chunkIndex: number) => recordProgress(chapter.index, chunkIndex),
      onChapterEnd: () => void goToChapter(chapter.index + 1, true),
    }

    let player = playerRef.current
    if (!player) {
      player = new Player(engine, { bookId, rate: settings.speed, ...handlers })
      playerRef.current = player
      player.subscribe(setPlayerState)
      setPlayerState(player.getState())
    } else {
      player.setOptions(handlers)
      player.setEngine(engine)
    }

    // Resume when the chapter changed underneath active playback, or when it
    // was loaded specifically to continue reading (chapter end, autoplay seek).
    const resume = player.getState().status === 'playing' || autoplayRef.current
    autoplayRef.current = false

    player.setChunks(chapter.chunks, chapter.sentences, startChunk)
    if (resume) void player.play()
    // Handlers close over the current chapter and are rebuilt with it on purpose.
    // Playback speed is applied separately so changing it does not restart audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, book, engine, settings.readingLang, bookId])

  useEffect(() => {
    playerRef.current?.setRate(settings.speed)
  }, [settings.speed])

  // Sentence splitting is locale-dependent, so switching reading language has
  // to re-segment the chapter that is already open.
  const readingLang = settings.readingLang
  const firstSegmentation = useRef(true)
  useEffect(() => {
    if (firstSegmentation.current) {
      firstSegmentation.current = false
      return
    }
    const index = chapterRef.current?.index
    if (index !== undefined) void loadChapter(index)
  }, [readingLang, loadChapter])

  // --- highlighting -------------------------------------------------------

  useEffect(() => {
    const root = contentRef.current
    const current = chapter
    if (!root || !current) return

    // While playing, exactly one sentence is lit. When stopped, the first
    // sentence of the pending chunk marks where playback will resume.
    const chunk = current.chunks[playerState.chunkIndex]
    const index =
      playerState.sentenceIndex >= 0 ? playerState.sentenceIndex : (chunk?.sentenceStart ?? -1)
    const first = highlightSentences(root, index >= 0 ? { from: index, to: index } : null)

    if (first && followRef.current && playerState.status !== 'idle') {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [chapter, playerState.chunkIndex, playerState.sentenceIndex, playerState.status])

  // --- media session ------------------------------------------------------

  useEffect(() => {
    if (!book) return

    setMediaMetadata({
      title: chapters[chapter?.index ?? 0]?.title ?? book.title,
      artist: book.author ?? '',
      album: book.title,
      artworkUrl: null,
    })

    return setMediaHandlers({
      play: () => void playerRef.current?.play(),
      pause: () => playerRef.current?.pause(),
      nextTrack: () => playerRef.current?.next(),
      previousTrack: () => playerRef.current?.previous(),
    })
  }, [book, chapters, chapter?.index])

  useEffect(() => {
    setPlaybackState(
      playerState.status === 'playing'
        ? 'playing'
        : playerState.status === 'idle'
          ? 'none'
          : 'paused',
    )
  }, [playerState.status])

  // --- progress -----------------------------------------------------------

  const recordProgress = useCallback(
    (chapterIndex: number, chunkIndex: number): void => {
      const chunkCount = chapterRef.current?.chunks.length ?? 0
      syncRef.current?.record({
        chapterIndex,
        chunkIndex,
        charOffset: chapterRef.current?.chunks[chunkIndex]?.start ?? 0,
        percent: computePercent(chapterIndex, chunkIndex, chunkCount, chapters.length || 1),
        updatedAt: Date.now(),
      })
    },
    [chapters.length],
  )

  useEffect(() => {
    const flush = (): void => {
      if (document.visibilityState === 'hidden') void syncRef.current?.flush()
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  // --- sleep timer --------------------------------------------------------

  useEffect(() => {
    if (sleepMinutes <= 0) return
    const timer = setTimeout(
      () => {
        playerRef.current?.pause()
        setSleepMinutes(0)
      },
      sleepMinutes * 60 * 1000,
    )
    return () => clearTimeout(timer)
  }, [sleepMinutes])

  // --- navigation ---------------------------------------------------------

  const goToChapter = useCallback(
    async (index: number, autoplay = false): Promise<void> => {
      const epub = epubRef.current
      if (!epub || index < 0 || index >= epub.chapters.length) {
        if (index >= (epub?.chapters.length ?? 0)) playerRef.current?.pause()
        return
      }
      if (autoplay) autoplayRef.current = true
      else playerRef.current?.pause()
      setShowChapters(false)
      // The player picks the chapter up once the new chunks are committed.
      await loadChapter(index)
    },
    [loadChapter],
  )

  const handleToggle = (): void => {
    // Must happen synchronously inside the gesture for iOS to allow playback.
    playerRef.current?.unlock()
    playerRef.current?.toggle()
  }

  const handleSentenceClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-sentence]')
    const current = chapterRef.current
    if (!target || !current) return

    const sentenceIndex = Number(target.dataset.sentence)
    if (!Number.isFinite(sentenceIndex)) return

    playerRef.current?.unlock()
    playerRef.current?.seekToSentence(sentenceIndex, true)
  }

  // --- render -------------------------------------------------------------

  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
        <Spinner /> {t('reader.loading')}
      </p>
    )
  }

  if (failedToLoad || !book) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <Banner tone="error">{t('reader.loadError')}</Banner>
        <Button className="mt-4" onClick={() => navigate({ name: 'library' })}>
          {t('nav.back')}
        </Button>
      </div>
    )
  }

  const chapterLabel =
    chapters[chapter?.index ?? 0]?.title ?? t('reader.chapter', { n: (chapter?.index ?? 0) + 1 })

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-2">
      <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-2 bg-slate-950/90 px-4 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate({ name: 'library' })}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('nav.back')}
        </button>

        <p className="min-w-0 flex-1 truncate text-center text-sm text-slate-400">{book.title}</p>

        <button
          type="button"
          onClick={() => setShowChapters(true)}
          className="rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          aria-label={t('reader.chapters')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
            <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 empty:hidden">
        {(playerState.error?.code === 'no_api_key' ||
          playerState.error?.code === 'invalid_api_key') && (
          <Banner
            tone="warn"
            action={
              <Button variant="primary" onClick={() => navigate({ name: 'settings' })}>
                {t('reader.goToSettings')}
              </Button>
            }
          >
            {playerState.error.code === 'no_api_key'
              ? t('reader.needsKey', { provider: PROVIDER_LABELS[settings.ttsProvider] })
              : t('reader.invalidKey', { provider: PROVIDER_LABELS[settings.ttsProvider] })}
          </Banner>
        )}

        {playerState.error &&
          playerState.error.code !== 'no_api_key' &&
          playerState.error.code !== 'invalid_api_key' && (
            <Banner
              tone="error"
              action={
                <Button onClick={() => void playerRef.current?.play()}>{t('common.retry')}</Button>
              }
            >
              {t('reader.ttsError', { detail: playerState.error.detail ?? playerState.error.code })}
            </Banner>
          )}

        {playerState.usingFallback && browserVoiceAvailable() && (
          <Banner
            tone="warn"
            action={
              <Button variant="primary" onClick={() => navigate({ name: 'settings' })}>
                {t('reader.goToSettings')}
              </Button>
            }
          >
            {t('reader.fellBackToBrowser', { provider: PROVIDER_LABELS[settings.ttsProvider] })}
            {playerState.fallbackReason && (
              <span className="mt-1 block text-xs opacity-80">
                {playerState.fallbackReason.detail ?? playerState.fallbackReason.code}
              </span>
            )}
          </Banner>
        )}

        {settings.useBrowserVoice && (
          <Banner tone="info">{t('reader.usingBrowserVoice')}</Banner>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">{chapterLabel}</h1>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
            className="size-4 accent-sky-500"
          />
          {t('reader.follow')}
        </label>
      </div>

      <p className="mb-4 text-xs text-slate-500">{t('reader.tapToStart')}</p>

      {/* Content is sanitized in openEpub before it reaches this point. */}
      <div
        ref={contentRef}
        onClick={handleSentenceClick}
        className="chapter font-serif text-[1.0625rem] leading-relaxed text-slate-200"
        dangerouslySetInnerHTML={{ __html: chapter?.html ?? '' }}
      />

      {showChapters && (
        <ChapterList
          chapters={chapters}
          currentIndex={chapter?.index ?? 0}
          onSelect={(index) => void goToChapter(index)}
          onClose={() => setShowChapters(false)}
        />
      )}

      <PlayerBar
        state={playerState}
        chunkCount={chapter?.chunks.length ?? 0}
        chapterLabel={chapterLabel}
        rate={settings.speed}
        canPreviousChapter={(chapter?.index ?? 0) > 0}
        canNextChapter={(chapter?.index ?? 0) < chapters.length - 1}
        sleepMinutes={sleepMinutes}
        onToggle={handleToggle}
        onPreviousSentence={() => playerRef.current?.previous()}
        onNextSentence={() => playerRef.current?.next()}
        onPreviousChapter={() => void goToChapter((chapter?.index ?? 0) - 1)}
        onNextChapter={() => void goToChapter((chapter?.index ?? 0) + 1)}
        onRateChange={(rate) => {
          // Applies immediately through playbackRate; persisting is best-effort.
          playerRef.current?.setRate(rate)
          void updateSettings({ speed: rate }).catch(() => {})
        }}
        onSleepChange={setSleepMinutes}
      />
    </div>
  )
}
