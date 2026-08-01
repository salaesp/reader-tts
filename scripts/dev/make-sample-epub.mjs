/**
 * Writes a small valid EPUB 3 with Spanish and English chapters, useful for
 * exercising the parser, the segmenter and playback without a real book.
 *
 *   node scripts/dev/make-sample-epub.mjs sample.epub
 */
import JSZip from 'jszip'
import { writeFileSync } from 'node:fs'

const chapters = [
  {
    id: 'c1',
    file: 'chapter1.xhtml',
    title: 'El faro',
    body: `<h1>El faro</h1>
      <p>La luz del faro barría la costa cada doce segundos. Marta contaba los intervalos
      desde la ventana de la cocina, con las manos alrededor de una taza que ya se había
      enfriado. Afuera, el viento del sur empujaba la lluvia contra los vidrios.</p>
      <p>—¿Vas a bajar al puerto? —preguntó su hermano desde el pasillo.</p>
      <p>Ella no respondió enseguida. Pensaba en el <em>Rosario</em>, el barco que no había
      vuelto en tres días, y en lo que significaba que la radio siguiera en silencio.</p>`,
  },
  {
    id: 'c2',
    file: 'chapter2.xhtml',
    title: 'The Lighthouse',
    body: `<h1>The Lighthouse</h1>
      <p>The beam swept the coast every twelve seconds. Marta counted the intervals from the
      kitchen window, her hands wrapped around a cup that had long gone cold.</p>
      <p>"Are you going down to the harbour?" her brother asked from the hallway.</p>
      <p>She did not answer straight away. She was thinking about the <em>Rosario</em>, the
      boat that had not come back in three days.</p>`,
  },
  {
    id: 'c3',
    file: 'chapter3.xhtml',
    title: 'La radio',
    body: `<h1>La radio</h1>
      <p>A las cuatro de la mañana la radio crujió una sola vez. Fue un sonido corto, casi
      un carraspeo, y después volvió el silencio.</p>
      <p>Marta se levantó de un salto. Giró el dial despacio, milímetro a milímetro,
      buscando otra vez esa frecuencia. El faro seguía girando sobre el agua negra.</p>`,
  },
]

const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip')
zip.file(
  'META-INF/container.xml',
  `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"
    media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
)

for (const chapter of chapters) {
  zip.file(
    `OEBPS/${chapter.file}`,
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es">
  <head><title>${chapter.title}</title></head>
  <body>${chapter.body}</body>
</html>`,
  )
}

zip.file(
  'OEBPS/nav.xhtml',
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol>
    ${chapters.map((c) => `<li><a href="${c.file}">${c.title}</a></li>`).join('\n    ')}
  </ol></nav></body></html>`,
)

// 1x1 PNG, enough to exercise the cover path.
zip.file(
  'OEBPS/cover.png',
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

zip.file(
  'OEBPS/content.opf',
  `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:reader-tts-sample</dc:identifier>
    <dc:title>El faro y la radio</dc:title>
    <dc:creator>Marta Iribarne</dc:creator>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    ${chapters
      .map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`)
      .join('\n    ')}
  </manifest>
  <spine>
    ${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ')}
  </spine>
</package>`,
)

const output = process.argv[2] ?? 'sample.epub'
const buffer = await zip.generateAsync({ type: 'nodebuffer' })
writeFileSync(output, buffer)
console.log(`wrote ${output} (${buffer.length} bytes)`)
