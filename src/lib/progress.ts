import type { Progress } from '../../shared/types'
import { api } from './api'
import { store } from './store'

const SYNC_DEBOUNCE_MS = 5000

/**
 * Persists reading position. Writes to IndexedDB immediately so nothing is lost
 * when the tab dies, and pushes to the server on a debounce — a chunk boundary
 * fires every few seconds and each one does not deserve a request.
 */
export class ProgressSync {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: Progress | null = null
  private lastSent = 0

  constructor(private readonly bookId: string) {}

  record(progress: Progress): void {
    this.pending = progress
    void store.saveProgress(this.bookId, progress)

    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, SYNC_DEBOUNCE_MS)
  }

  /** Pushes the pending position now. Safe to call when there is nothing to do. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const progress = this.pending
    if (!progress || progress.updatedAt === this.lastSent) return

    try {
      await api.putProgress(this.bookId, progress)
      this.lastSent = progress.updatedAt
    } catch {
      // Offline: the local copy stands and the next flush retries.
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/** Picks the newer of the local and remote positions. */
export function mergeProgress(
  local: Progress | undefined,
  remote: Progress | null | undefined,
): Progress | null {
  if (!local) return remote ?? null
  if (!remote) return local
  return local.updatedAt >= remote.updatedAt ? local : remote
}

export function computePercent(
  chapterIndex: number,
  chunkIndex: number,
  chunkCount: number,
  chapterCount: number,
): number {
  if (chapterCount <= 0) return 0
  const withinChapter = chunkCount > 0 ? Math.min(1, (chunkIndex + 1) / chunkCount) : 0
  return Math.min(100, ((chapterIndex + withinChapter) / chapterCount) * 100)
}
