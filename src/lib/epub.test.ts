import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { EpubError, normalizePath, openEpub, resolvePath } from './epub'

interface FixtureOptions {
  /** Use an NCX table of contents instead of the EPUB 3 nav document. */
  ncxToc?: boolean
  withCover?: boolean
  /** Put the OPF in a subdirectory to exercise relative path resolution. */
  nested?: boolean
}

/** Builds a minimal but structurally valid EPUB in memory. */
async function buildEpub(options: FixtureOptions = {}): Promise<Blob> {
  const dir = options.nested ? 'OEBPS/' : ''
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
     <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
       <rootfiles><rootfile full-path="${dir}content.opf"
         media-type="application/oebps-package+xml"/></rootfiles>
     </container>`,
  )

  zip.file(
    `${dir}chapter1.xhtml`,
    `<?xml version="1.0" encoding="utf-8"?>
     <html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title>
       <style>p { color: red }</style></head>
       <body>
         <h1>El comienzo</h1>
         <p>Era una tarde de <em>verano</em>. Todo estaba tranquilo.</p>
         <script>alert('xss')</script>
         <img src="art.png" alt="art"/>
       </body></html>`,
  )
  zip.file(
    `${dir}chapter2.xhtml`,
    `<?xml version="1.0" encoding="utf-8"?>
     <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>
       <body><h1>El final</h1><p>Y así terminó.</p></body></html>`,
  )
  zip.file(`${dir}art.png`, 'not-a-real-png', { binary: false })
  if (options.withCover) zip.file(`${dir}cover.png`, 'cover-bytes')

  const tocManifest = options.ncxToc
    ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
    : `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`

  if (options.ncxToc) {
    zip.file(
      `${dir}toc.ncx`,
      `<?xml version="1.0"?>
       <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
         <navPoint id="n1"><navLabel><text>El comienzo</text></navLabel>
           <content src="chapter1.xhtml"/></navPoint>
         <navPoint id="n2"><navLabel><text>El final</text></navLabel>
           <content src="chapter2.xhtml"/></navPoint>
       </navMap></ncx>`,
    )
  } else {
    zip.file(
      `${dir}nav.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?>
       <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
         <body><nav epub:type="toc"><ol>
           <li><a href="chapter1.xhtml">El comienzo</a></li>
           <li><a href="chapter2.xhtml#top">El final</a></li>
         </ol></nav></body></html>`,
    )
  }

  zip.file(
    `${dir}content.opf`,
    `<?xml version="1.0" encoding="utf-8"?>
     <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
       <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
         <dc:title>La tarde larga</dc:title>
         <dc:creator>Ana Pérez</dc:creator>
         <dc:language>es</dc:language>
       </metadata>
       <manifest>
         ${tocManifest}
         <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
         <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
         <item id="art" href="art.png" media-type="image/png"/>
         ${
           options.withCover
             ? '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>'
             : ''
         }
       </manifest>
       <spine${options.ncxToc ? ' toc="ncx"' : ''}>
         ${options.ncxToc ? '' : '<itemref idref="nav"/>'}
         <itemref idref="c1"/>
         <itemref idref="c2"/>
       </spine>
     </package>`,
  )

  return zip.generateAsync({ type: 'blob' })
}

describe('openEpub', () => {
  it('reads title, author and language from the OPF', async () => {
    const book = await openEpub(await buildEpub())

    expect(book.metadata).toEqual({
      title: 'La tarde larga',
      author: 'Ana Pérez',
      language: 'es',
    })
    book.dispose()
  })

  it('lists spine documents and excludes the navigation document', async () => {
    const book = await openEpub(await buildEpub())

    expect(book.chapters).toHaveLength(2)
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['El comienzo', 'El final'])
    book.dispose()
  })

  it('reads chapter titles from an NCX table of contents', async () => {
    const book = await openEpub(await buildEpub({ ncxToc: true }))

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['El comienzo', 'El final'])
    book.dispose()
  })

  it('extracts plain text with block elements separated', async () => {
    const book = await openEpub(await buildEpub())
    const { text } = await book.loadChapter(0)

    expect(text).toContain('El comienzo')
    expect(text).toContain('Era una tarde de verano. Todo estaba tranquilo.')
    // The heading must not run into the paragraph that follows it.
    expect(text).toMatch(/El comienzo\nEra una tarde/)
    expect(text).not.toContain('alert')
    book.dispose()
  })

  it('strips scripts and styles from the rendered HTML', async () => {
    const book = await openEpub(await buildEpub())
    const { html } = await book.loadChapter(0)

    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<style/i)
    expect(html).toMatch(/<em>verano<\/em>/)
    book.dispose()
  })

  it('rewrites image sources to blob URLs', async () => {
    const book = await openEpub(await buildEpub())
    const { html } = await book.loadChapter(0)

    expect(html).toMatch(/<img[^>]+src="blob:/)
    book.dispose()
  })

  it('resolves paths when the OPF lives in a subdirectory', async () => {
    const book = await openEpub(await buildEpub({ nested: true }))

    expect(book.chapters).toHaveLength(2)
    expect((await book.loadChapter(1)).text).toContain('Y así terminó.')
    book.dispose()
  })

  it('returns the cover image when the manifest declares one', async () => {
    const book = await openEpub(await buildEpub({ withCover: true }))

    expect(book.cover?.type).toBe('image/png')
    expect(book.cover?.blob.size).toBeGreaterThan(0)
    book.dispose()
  })

  it('reports no cover when the book has none', async () => {
    const book = await openEpub(await buildEpub())

    expect(book.cover).toBeNull()
    book.dispose()
  })

  it('rejects a file that is not a zip', async () => {
    await expect(openEpub(new Blob(['just some text']))).rejects.toThrow(EpubError)
  })

  it('rejects a zip without container.xml', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'hi')

    await expect(openEpub(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow(
      /container\.xml/,
    )
  })

  it('rejects a chapter index outside the spine', async () => {
    const book = await openEpub(await buildEpub())

    await expect(book.loadChapter(99)).rejects.toThrow(/out of range/)
    book.dispose()
  })
})

describe('path helpers', () => {
  it('normalizes traversal segments', () => {
    expect(normalizePath('OEBPS/../images/./a.png')).toBe('images/a.png')
  })

  it('resolves relative paths against a base directory', () => {
    expect(resolvePath('OEBPS/text', '../images/a.png')).toBe('OEBPS/images/a.png')
    expect(resolvePath('OEBPS', 'chapter1.xhtml')).toBe('OEBPS/chapter1.xhtml')
    expect(resolvePath('OEBPS', '/absolute.xhtml')).toBe('absolute.xhtml')
  })
})
