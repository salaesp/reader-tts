import JSZip from 'jszip'
import DOMPurify from 'dompurify'

/**
 * Minimal EPUB 2/3 reader.
 *
 * We parse the container and OPF ourselves instead of using epub.js because the
 * reader needs each sentence as an addressable element in the main document:
 * epub.js renders chapters inside an iframe, which makes highlighting the
 * sentence being spoken and mapping it back to a progress offset painful.
 */

export interface EpubMetadata {
  title: string
  author: string | null
  language: string | null
}

export interface EpubChapter {
  /** Position in the spine. */
  index: number
  /** Path of the document inside the zip. */
  href: string
  /** Title from the table of contents, when the chapter appears there. */
  title: string | null
}

export interface ChapterContent {
  /** Sanitized HTML, with internal image sources rewritten to blob URLs. */
  html: string
  /** Plain text used for sentence segmentation, in document order. */
  text: string
}

export interface EpubBook {
  metadata: EpubMetadata
  chapters: EpubChapter[]
  /** Raw cover image bytes, when the book declares one. */
  cover: { blob: Blob; type: string } | null
  loadChapter: (index: number) => Promise<ChapterContent>
  /** Revokes every blob URL created while rendering chapters. */
  dispose: () => void
}

const XHTML_MIME = /^(application\/xhtml\+xml|text\/html|application\/x-dtbncx\+xml|text\/xml)$/

export class EpubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubError'
  }
}

export async function openEpub(source: Blob | ArrayBuffer): Promise<EpubBook> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(source)
  } catch (err) {
    throw new EpubError(`not a readable zip: ${err instanceof Error ? err.message : String(err)}`)
  }

  const opfPath = await findOpfPath(zip)
  const opfDoc = await readXml(zip, opfPath)
  const opfDir = dirname(opfPath)

  const metadata = readMetadata(opfDoc)
  const manifest = readManifest(opfDoc, opfDir)
  const spine = readSpine(opfDoc, manifest)
  if (spine.length === 0) throw new EpubError('the spine has no readable documents')

  const titles = await readTocTitles(zip, opfDoc, manifest, opfDir)
  const chapters: EpubChapter[] = spine.map((item, index) => ({
    index,
    href: item.href,
    title: titles.get(normalizePath(item.href)) ?? null,
  }))

  const cover = await readCover(zip, opfDoc, manifest)
  const objectUrls: string[] = []

  const loadChapter = async (index: number): Promise<ChapterContent> => {
    const chapter = spine[index]
    if (!chapter) throw new EpubError(`chapter ${index} is out of range`)

    const raw = await readText(zip, chapter.href)
    const doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml')
    const body =
      doc.querySelector('parsererror') || !doc.body
        ? new DOMParser().parseFromString(raw, 'text/html').body
        : doc.body
    if (!body) return { html: '', text: '' }

    await inlineImages(zip, body, dirname(chapter.href), objectUrls)
    stripNonContent(body)

    const html = DOMPurify.sanitize(body.innerHTML, {
      ALLOWED_URI_REGEXP: /^(?:blob:|data:image\/)/i,
      FORBID_TAGS: ['style', 'script', 'link', 'iframe', 'object', 'embed', 'form', 'input'],
      FORBID_ATTR: ['style', 'class', 'id', 'srcset'],
    })

    return { html, text: extractText(body) }
  }

  return {
    metadata,
    chapters,
    cover,
    loadChapter,
    dispose: () => {
      for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url)
    },
  }
}

async function findOpfPath(zip: JSZip): Promise<string> {
  const container = zip.file('META-INF/container.xml')
  if (!container) throw new EpubError('META-INF/container.xml is missing')
  const doc = parseXml(await container.async('string'), 'META-INF/container.xml')
  const rootfile = doc.querySelector('rootfile')
  const path = rootfile?.getAttribute('full-path')
  if (!path) throw new EpubError('container.xml does not declare a rootfile')
  return normalizePath(path)
}

function readMetadata(opf: Document): EpubMetadata {
  const pick = (name: string): string | null => {
    const byLocalName = [...opf.getElementsByTagName('*')].find(
      (el) => el.localName === name && el.namespaceURI?.includes('dc/elements'),
    )
    const fallback = opf.getElementsByTagName(`dc:${name}`)[0] ?? opf.getElementsByTagName(name)[0]
    const text = (byLocalName ?? fallback)?.textContent?.trim()
    return text ? text : null
  }

  const authors = [...opf.getElementsByTagName('*')]
    .filter((el) => el.localName === 'creator')
    .map((el) => el.textContent?.trim())
    .filter((value): value is string => Boolean(value))

  return {
    title: pick('title') ?? 'Untitled',
    author: authors.length > 0 ? authors.join(', ') : null,
    language: pick('language'),
  }
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties: string
}

function readManifest(opf: Document, opfDir: string): Map<string, ManifestItem> {
  const items = new Map<string, ManifestItem>()
  for (const el of [...opf.getElementsByTagName('*')].filter((e) => e.localName === 'item')) {
    const id = el.getAttribute('id')
    const href = el.getAttribute('href')
    if (!id || !href) continue
    items.set(id, {
      id,
      href: resolvePath(opfDir, decodeURIComponent(href)),
      mediaType: el.getAttribute('media-type') ?? '',
      properties: el.getAttribute('properties') ?? '',
    })
  }
  return items
}

function readSpine(opf: Document, manifest: Map<string, ManifestItem>): ManifestItem[] {
  const spine: ManifestItem[] = []
  for (const el of [...opf.getElementsByTagName('*')].filter((e) => e.localName === 'itemref')) {
    const idref = el.getAttribute('idref')
    if (!idref) continue
    const item = manifest.get(idref)
    // Skip the navigation document itself: it is a table of contents, not prose.
    if (!item || !XHTML_MIME.test(item.mediaType) || item.properties.includes('nav')) continue
    spine.push(item)
  }
  return spine
}

/** Maps chapter paths to their table-of-contents titles (EPUB 3 nav, then NCX). */
async function readTocTitles(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
  opfDir: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>()

  const nav = [...manifest.values()].find((item) => item.properties.includes('nav'))
  if (nav) {
    try {
      const doc = parseXml(await readText(zip, nav.href), nav.href)
      for (const anchor of doc.querySelectorAll('nav a[href]')) {
        addTocEntry(titles, dirname(nav.href), anchor.getAttribute('href'), anchor.textContent)
      }
    } catch {
      // Fall through to the NCX below.
    }
  }

  if (titles.size === 0) {
    const spineEl = [...opf.getElementsByTagName('*')].find((e) => e.localName === 'spine')
    const ncxId = spineEl?.getAttribute('toc')
    const ncx =
      (ncxId ? manifest.get(ncxId) : undefined) ??
      [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml')
    if (ncx) {
      try {
        const doc = parseXml(await readText(zip, ncx.href), ncx.href)
        for (const point of doc.getElementsByTagName('navPoint')) {
          const label = point.getElementsByTagName('text')[0]?.textContent
          const src = point.getElementsByTagName('content')[0]?.getAttribute('src')
          addTocEntry(titles, dirname(ncx.href), src, label)
        }
      } catch {
        // A missing or broken ToC only costs us chapter names.
      }
    }
  }

  void opfDir
  return titles
}

function addTocEntry(
  titles: Map<string, string>,
  baseDir: string,
  href: string | null,
  label: string | null | undefined,
): void {
  const text = label?.trim()
  if (!href || !text) return
  const path = normalizePath(resolvePath(baseDir, decodeURIComponent(href.split('#')[0])))
  if (path && !titles.has(path)) titles.set(path, text)
}

async function readCover(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
): Promise<{ blob: Blob; type: string } | null> {
  let item = [...manifest.values()].find((entry) => entry.properties.includes('cover-image'))

  if (!item) {
    const meta = [...opf.getElementsByTagName('*')].find(
      (el) => el.localName === 'meta' && el.getAttribute('name') === 'cover',
    )
    const id = meta?.getAttribute('content')
    if (id) item = manifest.get(id)
  }
  if (!item) {
    item = [...manifest.values()].find(
      (entry) => entry.mediaType.startsWith('image/') && /cover/i.test(entry.href),
    )
  }
  if (!item || !item.mediaType.startsWith('image/')) return null

  const file = zip.file(item.href)
  if (!file) return null
  return { blob: await file.async('blob'), type: item.mediaType }
}

/** Replaces zip-relative image sources with blob URLs the document can render. */
async function inlineImages(
  zip: JSZip,
  root: HTMLElement,
  baseDir: string,
  objectUrls: string[],
): Promise<void> {
  const images = [...root.querySelectorAll('img, image')]
  await Promise.all(
    images.map(async (el) => {
      const attr = el.tagName.toLowerCase() === 'image' ? 'xlink:href' : 'src'
      const src = el.getAttribute(attr) ?? el.getAttribute('href') ?? el.getAttribute('src')
      if (!src || /^(data:|blob:|https?:)/i.test(src)) return

      const path = resolvePath(baseDir, decodeURIComponent(src.split('#')[0]))
      const file = zip.file(path)
      if (!file) {
        el.remove()
        return
      }
      const url = URL.createObjectURL(await file.async('blob'))
      objectUrls.push(url)
      if (el.tagName.toLowerCase() === 'image') {
        el.replaceWith(Object.assign(document.createElement('img'), { src: url, alt: '' }))
      } else {
        el.setAttribute('src', url)
      }
    }),
  )
}

function stripNonContent(root: HTMLElement): void {
  for (const el of root.querySelectorAll('script, style, link, iframe, object, embed, svg title')) {
    el.remove()
  }
  // Footnote markers and page-number anchors add noise when read aloud.
  for (const el of root.querySelectorAll('[epub\\:type="pagebreak"], [role="doc-pagebreak"]')) {
    el.remove()
  }
}

/**
 * Plain text in document order. Block elements become paragraph breaks so the
 * sentence splitter does not run two headings together.
 */
function extractText(root: HTMLElement): string {
  const blocks = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
    'SECTION', 'ARTICLE', 'TD', 'TH', 'TR', 'FIGCAPTION', 'BR', 'HR', 'PRE',
  ])

  let out = ''
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as Element
    const isBlock = blocks.has(el.tagName)
    if (isBlock && out && !out.endsWith('\n')) out += '\n'
    for (const child of el.childNodes) walk(child)
    if (isBlock && out && !out.endsWith('\n')) out += '\n'
  }
  walk(root)

  return out
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path) ?? zip.file(decodeURIComponent(path))
  if (!file) throw new EpubError(`missing file in epub: ${path}`)
  return file.async('string')
}

async function readXml(zip: JSZip, path: string): Promise<Document> {
  return parseXml(await readText(zip, path), path)
}

function parseXml(source: string, path: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  const error = doc.querySelector('parsererror')
  if (error) throw new EpubError(`malformed XML in ${path}`)
  return doc
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function resolvePath(baseDir: string, relative: string): string {
  if (relative.startsWith('/')) return normalizePath(relative.slice(1))
  return normalizePath(baseDir ? `${baseDir}/${relative}` : relative)
}

export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}
