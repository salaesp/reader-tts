import type { ReadingLang } from '../../shared/types'
import { ApiError } from './api'
import type { Chunk } from './segmenter'
import { store } from './store'
import type { CloudTtsEngine } from './tts'
import { MissingApiKeyError } from './tts'

/**
 * Renders every chunk of a chapter ahead of time so it can be listened to
 * offline.
 *
 * Synthesis goes through `CloudTtsEngine.synthesize`, which already writes to
 * the same IndexedDB cache the player reads from — one write path, not two.
 * After a download the player's prefetches simply hit the cache.
 */

/**
 * Two at a time. The player's own prefetch (`PREFETCH_AHEAD` in player.ts) may
 * be running against the same API key while this does, and no provider
 * publishes the rate limit we would be aiming at.
 */
export const DOWNLOAD_CONCURRENCY = 2

const RETRY_DELAY_MS = 800

export interface DownloadProgress {
  /** Chunks rendered in this run. */
  done: number
  /** Chunks that will not be retried automatically. */
  failed: number
  /** Chunks this run set out to render, excluding those already cached. */
  total: number
}

export interface DownloadResult extends DownloadProgress {
  /** Set when the run stopped early; every remaining chunk would have failed. */
  stoppedBy: 'no_api_key' | 'invalid_api_key' | 'quota_exceeded' | 'storage_full' | null
  /** First error seen, for the message shown to the reader. */
  error: unknown
  cancelled: boolean
}

export interface DownloadOptions {
  engine: CloudTtsEngine
  chunks: Chunk[]
  bookId: string
  lang: ReadingLang
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
}

/**
 * Why an error means every other chunk is doomed too.
 *
 * A rejected key or an exhausted quota fails identically for every remaining
 * chunk, and each of those failures is a paid round trip. Continuing would burn
 * the rest of the chapter's requests to learn what the first one already said.
 */
function terminalReason(err: unknown): DownloadResult['stoppedBy'] {
  if (err instanceof MissingApiKeyError) return 'no_api_key'
  if (!(err instanceof ApiError)) return null
  if (err.needsApiKey) return 'no_api_key'
  if (err.code === 'tts_quota_exceeded' || err.status === 402) return 'quota_exceeded'
  if (err.code === 'invalid_api_key' || err.status === 401 || err.status === 403) {
    return 'invalid_api_key'
  }
  return null
}

/** A blip worth one more try; anything else is counted and skipped. */
function worthRetrying(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'network_error' || err.status >= 500)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export async function downloadChunks({
  engine,
  chunks,
  bookId,
  lang,
  signal,
  onProgress,
}: DownloadOptions): Promise<DownloadResult> {
  const hashes = await Promise.all(chunks.map((chunk) => engine.hash(chunk.text)))
  const cached = await store.cachedHashes(bookId)

  // Only what is actually missing, so progress counts work rather than instant
  // cache hits.
  const pending = chunks.filter((_, index) => !cached.has(hashes[index]))

  const result: DownloadResult = {
    done: 0,
    failed: 0,
    total: pending.length,
    stoppedBy: null,
    error: null,
    cancelled: false,
  }
  if (pending.length === 0) return result

  const report = (): void => onProgress?.({ ...result })
  let next = 0

  const renderOne = async (chunk: Chunk): Promise<void> => {
    try {
      await engine.synthesize(chunk.text, { lang, bookId }, signal)
      result.done++
      return
    } catch (err) {
      if (isAbort(err)) throw err

      const terminal = terminalReason(err)
      if (terminal) {
        result.stoppedBy = terminal
        result.error ??= err
        return
      }

      if (!worthRetrying(err)) {
        result.failed++
        result.error ??= err
        return
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

      try {
        await engine.synthesize(chunk.text, { lang, bookId }, signal)
        result.done++
      } catch (retryErr) {
        if (isAbort(retryErr)) throw retryErr
        result.stoppedBy = terminalReason(retryErr)
        if (!result.stoppedBy) result.failed++
        result.error ??= retryErr
      }
    }
  }

  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      // A terminal error stops every worker, not just the one that hit it.
      if (result.stoppedBy || signal?.aborted) return
      const chunk = pending[next++]
      await renderOne(chunk)
      report()
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, pending.length) }, worker),
    )
  } catch (err) {
    if (!isAbort(err)) throw err
    result.cancelled = true
  }

  if (signal?.aborted) result.cancelled = true

  // A full quota rejects the writes silently: synthesis succeeded, so the audio
  // was paid for, but none of it is on the device. Saying "downloaded" here
  // would send someone underground with nothing to play.
  if (!result.cancelled && result.done > 0) {
    const stored = await store.cachedHashes(bookId)
    const missing = hashes.filter((hash) => !stored.has(hash)).length
    if (missing > 0) {
      result.stoppedBy ??= 'storage_full'
      result.failed += missing
      result.done = Math.max(0, result.done - missing)
    }
  }

  report()
  return result
}
