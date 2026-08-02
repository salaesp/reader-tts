import { useEffect, useRef, useState } from 'react'
import type { ReadingLang } from '../../shared/types'
import type { Translate, TranslateKey } from '../i18n'
import { useI18n } from '../i18n'
import type { DownloadResult } from '../lib/download'
import { downloadChunks } from '../lib/download'
import type { ChapterWork } from '../lib/estimate'
import type { Chunk } from '../lib/segmenter'
import type { CloudTtsEngine } from '../lib/tts'
import { Button, ProgressBar } from './ui'

/**
 * Renders the whole chapter up front so it can be played without a connection.
 *
 * The audio cache is otherwise filled only by playback, which means a chapter
 * you have not listened to yet is unavailable the moment you lose signal —
 * exactly when a book is most useful.
 */
export function ChapterDownload({
  engine,
  chunks,
  bookId,
  lang,
  work,
  costLabel,
  onFinished,
}: {
  /** Null when the browser voice is on: there is nothing to pre-render. */
  engine: CloudTtsEngine | null
  chunks: Chunk[]
  bookId: string
  lang: ReadingLang
  work: ChapterWork | null
  /** The estimate from ChapterCost, so the cost is known before committing. */
  costLabel: string | null
  onFinished?: () => void
}) {
  const { t } = useI18n()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<DownloadResult | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  // A different chapter is a different download; drop whatever was shown.
  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setProgress(null)
    setResult(null)
  }, [bookId, chunks])

  useEffect(() => () => controllerRef.current?.abort(), [])

  if (chunks.length === 0) return null

  // The browser voice speaks as it goes, so there is no audio to fetch ahead.
  // The button stays visible and disabled: hiding it reads as "cannot do this".
  if (!engine) {
    return (
      <span className="text-xs text-slate-500" title={t('reader.downloadBrowserVoiceHelp')}>
        {t('reader.downloadBrowserVoice')}
      </span>
    )
  }

  if (progress) {
    const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ProgressBar
          percent={percent}
          label={t('reader.downloading')}
          className="min-w-16 flex-1"
        />
        <span className="shrink-0 text-xs tabular-nums text-slate-400">
          {progress.done}/{progress.total}
        </span>
        <button
          type="button"
          onClick={() => controllerRef.current?.abort()}
          className="shrink-0 text-xs text-slate-400 hover:text-red-400"
        >
          {t('common.cancel')}
        </button>
      </span>
    )
  }

  if (result) {
    const message = describeResult(result, t)
    if (message) {
      return (
        <span className="flex items-center gap-2">
          <span className="text-xs text-amber-400">{message}</span>
          <button
            type="button"
            onClick={() => void start()}
            className="text-xs text-sky-400 hover:underline"
          >
            {t('common.retry')}
          </button>
        </span>
      )
    }
    return <span className="text-xs text-emerald-400">{t('reader.downloaded')}</span>
  }

  if (work && work.pendingChunks === 0) {
    return <span className="text-xs text-emerald-400">{t('reader.downloaded')}</span>
  }

  return (
    <Button onClick={() => void start()} className="shrink-0 text-xs">
      {costLabel ? t('reader.downloadWithCost', { cost: costLabel }) : t('reader.download')}
    </Button>
  )

  async function start(): Promise<void> {
    if (!engine) return
    const controller = new AbortController()
    controllerRef.current = controller
    setResult(null)
    setProgress({ done: 0, total: work?.pendingChunks ?? chunks.length })

    try {
      const finished = await downloadChunks({
        engine,
        chunks,
        bookId,
        lang,
        signal: controller.signal,
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      })
      // A cancelled run keeps what it managed to fetch; saying so would be
      // noise on top of an action the reader just took deliberately.
      setResult(finished.cancelled ? null : finished)
    } catch (err) {
      console.error('chapter download failed', err)
      setResult(null)
    } finally {
      controllerRef.current = null
      setProgress(null)
      onFinished?.()
    }
  }
}

/** Null when the run finished cleanly and there is nothing to explain. */
function describeResult(result: DownloadResult, t: Translate): string | null {
  const reasons: Record<NonNullable<DownloadResult['stoppedBy']>, TranslateKey> = {
    no_api_key: 'reader.downloadNoKey',
    invalid_api_key: 'reader.downloadInvalidKey',
    quota_exceeded: 'reader.downloadQuota',
    storage_full: 'reader.downloadStorageFull',
  }

  if (result.stoppedBy) return t(reasons[result.stoppedBy])
  if (result.failed > 0) return t('reader.downloadPartial', { failed: result.failed })
  return null
}
