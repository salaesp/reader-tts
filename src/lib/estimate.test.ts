import { describe, expect, it } from 'vitest'
import { estimateUsd, formatUsd } from '../../shared/types'
import { chapterWork } from './estimate'
import { buildChunks, splitSentences } from './segmenter'

function chapter() {
  const text =
    'Primera oración de prueba. Segunda oración algo más larga que la primera. ' +
    'Tercera oración para completar. Cuarta y última oración del capítulo.'
  const sentences = splitSentences(text, 'es')
  return buildChunks(sentences, 60)
}

describe('chapterWork', () => {
  it('counts everything as pending when nothing is cached', () => {
    const chunks = chapter()
    const hashes = chunks.map((_, i) => `h${i}`)

    const work = chapterWork(chunks, hashes, new Set())

    expect(work.pendingChunks).toBe(chunks.length)
    expect(work.totalChunks).toBe(chunks.length)
    expect(work.pendingChars).toBe(work.totalChars)
  })

  it('discounts the chunks already in the cache', () => {
    const chunks = chapter()
    const hashes = chunks.map((_, i) => `h${i}`)

    const work = chapterWork(chunks, hashes, new Set(['h0']))

    expect(work.pendingChunks).toBe(chunks.length - 1)
    expect(work.pendingChars).toBe(work.totalChars - chunks[0].text.length)
  })

  it('reports nothing pending once the whole chapter is cached', () => {
    const chunks = chapter()
    const hashes = chunks.map((_, i) => `h${i}`)

    const work = chapterWork(chunks, hashes, new Set(hashes))

    expect(work.pendingChunks).toBe(0)
    expect(work.pendingChars).toBe(0)
  })

  // Charging twice is recoverable; telling someone a chapter is downloaded
  // when it is not leaves them without audio where they expected it.
  it('treats a chunk with no known hash as pending', () => {
    const chunks = chapter()

    const work = chapterWork(chunks, [], new Set(['h0']))

    expect(work.pendingChunks).toBe(chunks.length)
  })

  it('handles an empty chapter without dividing by anything', () => {
    expect(chapterWork([], [], new Set())).toEqual({
      pendingChars: 0,
      pendingChunks: 0,
      totalChars: 0,
      totalChunks: 0,
    })
  })
})

describe('estimateUsd', () => {
  const pricing = { input: 0.000015, output: 0 }

  it('scales with the amount of text', () => {
    const small = estimateUsd(1000, 'es', pricing)
    const large = estimateUsd(10_000, 'es', pricing)

    expect(large!.usd).toBeCloseTo(small!.usd * 10, 10)
  })

  // Accented characters tokenise worse, so the same text costs more in Spanish.
  it('uses a different ratio per reading language', () => {
    expect(estimateUsd(1000, 'es', pricing)!.usd).toBeGreaterThan(
      estimateUsd(1000, 'en', pricing)!.usd,
    )
  })

  it('reports a floor when the model also bills output', () => {
    expect(estimateUsd(1000, 'es', { input: 0.00001, output: 0.00003 })!.isFloor).toBe(true)
    expect(estimateUsd(1000, 'es', pricing)!.isFloor).toBe(false)
  })

  // Same refusal as describePricing: unknown is not free.
  it('says nothing when the price is unknown', () => {
    expect(estimateUsd(1000, 'es', null)).toBeNull()
    expect(estimateUsd(1000, 'es', { input: null, output: null })).toBeNull()
  })

  it('costs nothing for no text', () => {
    expect(estimateUsd(0, 'es', pricing)!.usd).toBe(0)
  })
})

describe('formatUsd', () => {
  it('keeps a tiny amount from rounding to nothing', () => {
    expect(formatUsd(0.0004)).toBe('<$0.01')
  })

  it('shows cents in the range a chapter falls in', () => {
    expect(formatUsd(0.08)).toBe('$0.08')
    expect(formatUsd(1.5)).toBe('$1.50')
  })

  it('drops to one decimal once the number is large', () => {
    expect(formatUsd(12.34)).toBe('$12.3')
  })

  it('shows a real zero plainly', () => {
    expect(formatUsd(0)).toBe('$0')
  })
})
