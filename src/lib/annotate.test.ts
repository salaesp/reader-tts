import { describe, expect, it } from 'vitest'
import { buildTextIndex, highlightSentences, wrapSentences } from './annotate'
import { splitSentences } from './segmenter'

function render(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('buildTextIndex', () => {
  it('concatenates text in document order', () => {
    const index = buildTextIndex(render('<p>Hola <em>mundo</em> otra vez.</p>'))

    expect(index.text.trim()).toBe('Hola mundo otra vez.')
  })

  it('separates block elements with a newline', () => {
    const index = buildTextIndex(render('<h1>Título</h1><p>Cuerpo.</p>'))

    expect(index.text).toContain('Título\nCuerpo.')
  })

  it('records offsets that point back at the source text', () => {
    const index = buildTextIndex(render('<p>Uno</p><p>Dos</p>'))

    for (const entry of index.entries) {
      expect(index.text.slice(entry.start, entry.end)).toBe(entry.node.nodeValue)
    }
  })

  it('does not treat source line breaks inside a paragraph as a boundary', () => {
    // How a pretty-printed EPUB chapter actually looks on disk.
    const root = render('<p>Marta contó los intervalos desde la\n      ventana de la cocina.</p>')
    const index = buildTextIndex(root)

    // The only newline left is the structural one closing the block.
    expect(index.text.trim()).not.toContain('\n')
    expect(splitSentences(index.text, 'es')).toHaveLength(1)
  })

  it('keeps offsets valid after collapsing line breaks', () => {
    const root = render('<p>Una oración con\n      un salto de línea.</p>')
    const index = buildTextIndex(root)

    for (const entry of index.entries) {
      expect(index.text.slice(entry.start, entry.end).length).toBe(entry.node.nodeValue?.length)
    }
  })

  it('ignores script and style content', () => {
    const index = buildTextIndex(render('<p>Visible</p><script>secret()</script>'))

    expect(index.text).not.toContain('secret')
  })
})

describe('wrapSentences', () => {
  it('wraps every sentence in a tagged span', () => {
    const root = render('<p>Primera oración. Segunda oración.</p>')
    const index = buildTextIndex(root)
    const sentences = splitSentences(index.text, 'es')

    expect(wrapSentences(index, sentences)).toBe(2)
    expect(root.querySelectorAll('[data-sentence="0"]').length).toBeGreaterThan(0)
    expect(root.querySelectorAll('[data-sentence="1"]').length).toBeGreaterThan(0)
  })

  it('preserves the visible text exactly', () => {
    const root = render('<p>Hola <em>mundo</em>. ¿Todo bien?</p>')
    const before = root.textContent
    const index = buildTextIndex(root)

    wrapSentences(index, splitSentences(index.text, 'es'))

    expect(root.textContent).toBe(before)
  })

  it('keeps inline markup intact when a sentence spans it', () => {
    const root = render('<p>Era una tarde de <em>verano</em> tranquila.</p>')
    const index = buildTextIndex(root)

    wrapSentences(index, splitSentences(index.text, 'es'))

    expect(root.querySelector('em')?.textContent).toBe('verano')
    // The sentence crosses the <em>, so it needs more than one span.
    expect(root.querySelectorAll('[data-sentence="0"]').length).toBeGreaterThan(1)
  })

  it('spans across block elements without merging their text', () => {
    const root = render('<h1>Capítulo</h1><p>Empieza aquí.</p>')
    const index = buildTextIndex(root)
    const sentences = splitSentences(index.text, 'es')

    wrapSentences(index, sentences)

    expect(root.querySelector('h1')?.textContent).toBe('Capítulo')
    expect(root.querySelector('p')?.textContent).toBe('Empieza aquí.')
  })

  it('does nothing when there are no sentences', () => {
    const root = render('<p>Texto</p>')

    expect(wrapSentences(buildTextIndex(root), [])).toBe(0)
    expect(root.querySelectorAll('[data-sentence]')).toHaveLength(0)
  })
})

describe('highlightSentences', () => {
  it('marks only the sentences in the active range', () => {
    const root = render('<p>Uno. Dos. Tres.</p>')
    const index = buildTextIndex(root)
    wrapSentences(index, splitSentences(index.text, 'es'))

    highlightSentences(root, { from: 1, to: 1 })

    const active = [...root.querySelectorAll('.sentence-active')]
    expect(active).toHaveLength(1)
    expect(active[0].textContent).toBe('Dos.')
  })

  it('returns the first highlighted element for scrolling', () => {
    const root = render('<p>Uno. Dos. Tres.</p>')
    const index = buildTextIndex(root)
    wrapSentences(index, splitSentences(index.text, 'es'))

    expect(highlightSentences(root, { from: 2, to: 2 })?.textContent).toBe('Tres.')
  })

  it('clears the highlight when the range is null', () => {
    const root = render('<p>Uno. Dos.</p>')
    const index = buildTextIndex(root)
    wrapSentences(index, splitSentences(index.text, 'es'))
    highlightSentences(root, { from: 0, to: 0 })

    highlightSentences(root, null)

    expect(root.querySelectorAll('.sentence-active')).toHaveLength(0)
  })
})
