import { describe, expect, it } from 'vitest'
import { MAX_CHUNK_CHARS, buildChunks, splitSentences } from './segmenter'

describe('splitSentences', () => {
  it('splits Spanish prose on sentence punctuation', () => {
    const text = '¿Cómo estás? Muy bien, gracias. El día está lindo.'
    const sentences = splitSentences(text, 'es')

    expect(sentences.map((s) => s.text)).toEqual([
      '¿Cómo estás?',
      'Muy bien, gracias.',
      'El día está lindo.',
    ])
  })

  it('splits English prose and keeps offsets pointing at the source text', () => {
    const text = 'The sun rose. Birds sang loudly! Did anyone hear?'
    const sentences = splitSentences(text, 'en')

    expect(sentences).toHaveLength(3)
    for (const sentence of sentences) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text)
    }
  })

  it('does not merge a heading into the paragraph that follows it', () => {
    const sentences = splitSentences('Capítulo uno\nEmpezó a llover.', 'es')

    expect(sentences.map((s) => s.text)).toEqual(['Capítulo uno', 'Empezó a llover.'])
  })

  it('drops blank lines instead of emitting empty sentences', () => {
    const sentences = splitSentences('Uno.\n\n\nDos.', 'es')

    expect(sentences.map((s) => s.text)).toEqual(['Uno.', 'Dos.'])
  })

  it('breaks a sentence that exceeds the request limit', () => {
    const long = `${'palabra '.repeat(900).trim()}.`
    const sentences = splitSentences(long, 'es')

    expect(sentences.length).toBeGreaterThan(1)
    for (const sentence of sentences) {
      expect(sentence.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
  })

  it('returns nothing for empty input', () => {
    expect(splitSentences('   \n  ', 'es')).toEqual([])
  })
})

describe('buildChunks', () => {
  it('groups whole sentences up to the target size', () => {
    const sentences = splitSentences(
      Array.from({ length: 40 }, (_, i) => `Esta es la oración número ${i}.`).join(' '),
      'es',
    )
    const chunks = buildChunks(sentences, 200)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // Only the first sentence of a chunk may push it past the target.
      const sentenceCount = chunk.sentenceEnd - chunk.sentenceStart + 1
      expect(sentenceCount).toBeGreaterThanOrEqual(1)
      expect(chunk.text.endsWith('.')).toBe(true)
    }
  })

  it('covers every sentence exactly once and in order', () => {
    const sentences = splitSentences(
      'Uno. Dos. Tres. Cuatro. Cinco. Seis. Siete. Ocho. Nueve. Diez.',
      'es',
    )
    const chunks = buildChunks(sentences, 20)

    const covered: number[] = []
    for (const chunk of chunks) {
      for (let i = chunk.sentenceStart; i <= chunk.sentenceEnd; i++) covered.push(i)
    }
    expect(covered).toEqual(sentences.map((_, i) => i))
  })

  it('never splits a sentence across two chunks', () => {
    const sentences = splitSentences('Uno. Dos. Tres. Cuatro.', 'es')
    const chunks = buildChunks(sentences, 10)

    for (const chunk of chunks) {
      for (const sentence of sentences.slice(chunk.sentenceStart, chunk.sentenceEnd + 1)) {
        expect(chunk.text).toContain(sentence.text)
      }
    }
  })

  it('gives a sentence longer than the target its own chunk', () => {
    const sentences = splitSentences('Corta. Una oración considerablemente más larga aquí. Fin.', 'es')
    const chunks = buildChunks(sentences, 30)

    const long = chunks.find((chunk) => chunk.text.includes('considerablemente'))
    expect(long?.sentenceStart).toBe(long?.sentenceEnd)
  })

  it('returns no chunks for no sentences', () => {
    expect(buildChunks([], 100)).toEqual([])
  })

  it('numbers chunks sequentially from zero', () => {
    const sentences = splitSentences('A uno. B dos. C tres. D cuatro. E cinco.', 'es')
    const chunks = buildChunks(sentences, 12)

    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i))
  })
})
