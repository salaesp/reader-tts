import type { ReadingLang } from '../../shared/types'

/**
 * Splits chapter text into sentences and then groups those sentences into
 * chunks small enough for one TTS request. Chunks never cut a sentence in half:
 * a clause that ends mid-breath is immediately audible.
 */

export interface Sentence {
  text: string
  /** Character offset of the sentence within the chapter text. */
  start: number
  end: number
}

export interface Chunk {
  index: number
  text: string
  start: number
  end: number
  /** Indices into the sentence array, for highlighting while this chunk plays. */
  sentenceStart: number
  sentenceEnd: number
}

/** Roughly 60 seconds of speech: long enough to be efficient, short to start. */
export const TARGET_CHUNK_CHARS = 900
/** Server-side hard limit per request. */
export const MAX_CHUNK_CHARS = 3500

const LOCALES: Record<ReadingLang, string> = { es: 'es', en: 'en' }

type SegmenterCtor = new (
  locale: string,
  options: { granularity: 'sentence' },
) => { segment: (input: string) => Iterable<{ segment: string; index: number }> }

export function splitSentences(text: string, lang: ReadingLang): Sentence[] {
  const sentences: Sentence[] = []
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter

  const push = (raw: string, index: number): void => {
    const leading = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (!trimmed) return
    sentences.push({
      text: trimmed,
      start: index + leading,
      end: index + leading + trimmed.length,
    })
  }

  if (Segmenter) {
    // Paragraphs are segmented separately so a heading without punctuation does
    // not get glued to the sentence that follows it.
    for (const paragraph of splitParagraphs(text)) {
      const segmenter = new Segmenter(LOCALES[lang], { granularity: 'sentence' })
      for (const part of segmenter.segment(paragraph.text)) {
        push(part.segment, paragraph.start + part.index)
      }
    }
  } else {
    for (const paragraph of splitParagraphs(text)) {
      for (const match of paragraph.text.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g)) {
        push(match[0], paragraph.start + (match.index ?? 0))
      }
    }
  }

  return sentences.flatMap(splitOverlongSentence)
}

/**
 * A single "sentence" can still exceed the request limit in books with long
 * unpunctuated passages, so it is broken at clause boundaries as a last resort.
 */
function splitOverlongSentence(sentence: Sentence): Sentence[] {
  if (sentence.text.length <= MAX_CHUNK_CHARS) return [sentence]

  const parts: Sentence[] = []
  let cursor = 0
  while (cursor < sentence.text.length) {
    let end = Math.min(cursor + MAX_CHUNK_CHARS, sentence.text.length)
    if (end < sentence.text.length) {
      const window = sentence.text.slice(cursor, end)
      const breakAt = Math.max(
        window.lastIndexOf('; '),
        window.lastIndexOf(', '),
        window.lastIndexOf(' — '),
        window.lastIndexOf(' '),
      )
      if (breakAt > MAX_CHUNK_CHARS * 0.5) end = cursor + breakAt + 1
    }
    const text = sentence.text.slice(cursor, end).trim()
    if (text) {
      parts.push({ text, start: sentence.start + cursor, end: sentence.start + end })
    }
    cursor = end
  }
  return parts
}

function splitParagraphs(text: string): { text: string; start: number }[] {
  const paragraphs: { text: string; start: number }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    if (line.trim()) paragraphs.push({ text: line, start: offset })
    offset += line.length + 1
  }
  return paragraphs
}

export function buildChunks(
  sentences: Sentence[],
  target = TARGET_CHUNK_CHARS,
): Chunk[] {
  const chunks: Chunk[] = []
  let current: Sentence[] = []
  let firstIndex = 0

  const flush = (): void => {
    if (current.length === 0) return
    chunks.push({
      index: chunks.length,
      text: current.map((sentence) => sentence.text).join(' '),
      start: current[0].start,
      end: current[current.length - 1].end,
      sentenceStart: firstIndex,
      sentenceEnd: firstIndex + current.length - 1,
    })
    current = []
  }

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (current.length === 0) firstIndex = i

    const projected = current.reduce((sum, s) => sum + s.text.length + 1, 0) + sentence.text.length

    if (current.length > 0 && projected > target) {
      flush()
      firstIndex = i
    }
    current.push(sentence)

    // A sentence longer than the target becomes its own chunk.
    if (sentence.text.length >= target) flush()
  }
  flush()

  return chunks
}

/** sha-256 hex of the cache identity for a chunk. Must match the server's check. */
export async function chunkHash(
  provider: string,
  model: string,
  voice: string,
  text: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${provider}|${model}|${voice}|${text}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
