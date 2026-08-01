import type { Sentence } from './segmenter'

/**
 * Maps sentences onto the rendered chapter DOM.
 *
 * The text handed to the segmenter is built from the very nodes that are on
 * screen, so every sentence offset points at a real text node. Each sentence is
 * then wrapped in one or more `<span data-sentence>` elements — more than one
 * when the sentence crosses inline markup like `<em>` — which is what lets the
 * player highlight exactly what is being spoken.
 */

interface TextNodeEntry {
  node: Text
  start: number
  end: number
}

export interface TextIndex {
  text: string
  entries: TextNodeEntry[]
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
  'SECTION', 'ARTICLE', 'TD', 'TH', 'TR', 'FIGCAPTION', 'BR', 'HR', 'PRE', 'FIGURE',
])

/**
 * Concatenates the element's text in document order, inserting a newline at
 * block boundaries so the segmenter does not glue a heading to the paragraph
 * after it. Newlines are virtual: they belong to no text node.
 */
export function buildTextIndex(root: HTMLElement): TextIndex {
  const entries: TextNodeEntry[] = []
  let text = ''

  const appendBreak = (): void => {
    if (text && !text.endsWith('\n')) text += '\n'
  }

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? ''
      if (!value) return
      entries.push({ node: node as Text, start: text.length, end: text.length + value.length })
      // EPUB XHTML is pretty-printed, so paragraphs contain source line breaks.
      // Those are not paragraph boundaries and must not split a sentence, so
      // they collapse to spaces — a same-length substitution that keeps every
      // offset pointing at the same character of the original node.
      text += value.replace(/[\n\r\t]/g, ' ')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as Element
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return

    const isBlock = BLOCK_TAGS.has(element.tagName)
    if (isBlock) appendBreak()
    for (const child of [...element.childNodes]) walk(child)
    if (isBlock) appendBreak()
  }

  walk(root)
  return { text, entries }
}

/**
 * Wraps each sentence range in spans carrying its index.
 * Returns the number of sentences that got at least one span.
 */
export function wrapSentences(index: TextIndex, sentences: Sentence[]): number {
  // Collect every (node, range, sentence) triple before touching the DOM:
  // splitText invalidates the offsets computed for later nodes otherwise.
  const perNode = new Map<Text, { from: number; to: number; sentence: number }[]>()
  const covered = new Set<number>()

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    for (const entry of index.entries) {
      if (entry.end <= sentence.start) continue
      if (entry.start >= sentence.end) break

      const from = Math.max(sentence.start, entry.start) - entry.start
      const to = Math.min(sentence.end, entry.end) - entry.start
      if (to <= from) continue

      const ranges = perNode.get(entry.node) ?? []
      ranges.push({ from, to, sentence: sentenceIndex })
      perNode.set(entry.node, ranges)
      covered.add(sentenceIndex)
    }
  }

  for (const [node, ranges] of perNode) {
    // Apply back to front so each split leaves earlier offsets valid.
    ranges.sort((a, b) => b.from - a.from)

    for (const range of ranges) {
      const parent = node.parentNode
      if (!parent) continue

      const tail = range.to < (node.nodeValue?.length ?? 0) ? node.splitText(range.to) : null
      void tail
      const target = range.from > 0 ? node.splitText(range.from) : node

      const span = document.createElement('span')
      span.className = 'sentence sentence-tappable'
      span.dataset.sentence = String(range.sentence)
      target.parentNode?.replaceChild(span, target)
      span.appendChild(target)
    }
  }

  return covered.size
}

/** Applies the active highlight, clearing whatever was highlighted before. */
export function highlightSentences(
  root: HTMLElement,
  range: { from: number; to: number } | null,
): HTMLElement | null {
  let first: HTMLElement | null = null

  for (const element of root.querySelectorAll<HTMLElement>('[data-sentence]')) {
    const index = Number(element.dataset.sentence)
    const active = range !== null && index >= range.from && index <= range.to
    element.classList.toggle('sentence-active', active)
    if (active && !first) first = element
  }

  return first
}
