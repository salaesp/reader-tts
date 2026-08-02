import type { Chunk } from './segmenter'

/**
 * How much of a chapter has still to be paid for.
 *
 * Chunks already in the local cache replay for free, so an estimate that
 * ignored them would overstate the cost of a chapter you have mostly listened
 * to — and understate how close it is to being usable offline.
 */

export interface ChapterWork {
  pendingChars: number
  pendingChunks: number
  totalChars: number
  totalChunks: number
}

/**
 * `hashes` must line up with `chunks` by index; they come from
 * `CloudTtsEngine.hash`, which is also what the cache is keyed by. Deriving the
 * identity string here instead would let the two drift apart.
 */
export function chapterWork(
  chunks: Chunk[],
  hashes: string[],
  cached: ReadonlySet<string>,
): ChapterWork {
  let pendingChars = 0
  let pendingChunks = 0
  let totalChars = 0

  chunks.forEach((chunk, index) => {
    const chars = chunk.text.length
    totalChars += chars

    const hash = hashes[index]
    // An unknown hash counts as pending: charging for it twice is a smaller
    // error than promising it is already downloaded.
    if (hash !== undefined && cached.has(hash)) return
    pendingChars += chars
    pendingChunks++
  })

  return { pendingChars, pendingChunks, totalChars, totalChunks: chunks.length }
}
