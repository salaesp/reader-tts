import type { Book, Progress } from '../../../shared/types'
import type { Api } from '../../lib/env'
import { HttpError, json, requireUser } from '../../lib/http'

const MAX_EPUB_BYTES = 60 * 1024 * 1024
const MAX_COVER_BYTES = 4 * 1024 * 1024

interface BookRow {
  id: string
  title: string
  author: string | null
  language: string | null
  size_bytes: number
  cover_key: string | null
  added_at: number
  chapter_index: number | null
  chunk_index: number | null
  char_offset: number | null
  percent: number | null
  updated_at: number | null
}

export const onRequestGet: Api = async ({ env, data }) => {
  const user = requireUser(data.user)

  const { results } = await env.DB.prepare(
    `SELECT b.id, b.title, b.author, b.language, b.size_bytes, b.cover_key, b.added_at,
            p.chapter_index, p.chunk_index, p.char_offset, p.percent, p.updated_at
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = b.user_id
      WHERE b.user_id = ?
      ORDER BY COALESCE(p.updated_at, b.added_at) DESC`,
  )
    .bind(user.id)
    .all<BookRow>()

  return json({ books: results.map(rowToBook) })
}

/**
 * Upload. The client parses the EPUB before sending, so title/author/cover come
 * in as form fields rather than being re-parsed on the edge.
 */
export const onRequestPost: Api = async ({ request, env, data }) => {
  const user = requireUser(data.user)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'invalid_form')
  }

  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'missing_file')
  if (file.size === 0) throw new HttpError(400, 'empty_file')
  if (file.size > MAX_EPUB_BYTES) throw new HttpError(413, 'file_too_large')

  const title = (form.get('title') as string | null)?.trim() || file.name.replace(/\.epub$/i, '')
  const author = ((form.get('author') as string | null) ?? '').trim() || null
  const language = ((form.get('language') as string | null) ?? '').trim() || null

  const bookId = crypto.randomUUID()
  const r2Key = `epub/${user.id}/${bookId}.epub`

  await env.BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: 'application/epub+zip' },
  })

  let coverKey: string | null = null
  const cover = form.get('cover')
  if (cover instanceof File && cover.size > 0 && cover.size <= MAX_COVER_BYTES) {
    coverKey = `cover/${user.id}/${bookId}`
    await env.BUCKET.put(coverKey, cover.stream(), {
      httpMetadata: { contentType: cover.type || 'image/jpeg' },
    })
  }

  const addedAt = Date.now()
  try {
    await env.DB.prepare(
      `INSERT INTO books (id, user_id, title, author, language, r2_key, cover_key, size_bytes, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(bookId, user.id, title, author, language, r2Key, coverKey, file.size, addedAt)
      .run()
  } catch (err) {
    // Do not leave an orphaned object behind if the metadata insert fails.
    await env.BUCKET.delete(coverKey ? [r2Key, coverKey] : [r2Key])
    throw err
  }

  const book: Book = {
    id: bookId,
    title,
    author,
    language,
    sizeBytes: file.size,
    hasCover: coverKey !== null,
    addedAt,
    progress: null,
  }
  return json({ book }, { status: 201 })
}

export function rowToBook(row: BookRow): Book {
  const progress: Progress | null =
    row.updated_at === null
      ? null
      : {
          chapterIndex: row.chapter_index ?? 0,
          chunkIndex: row.chunk_index ?? 0,
          charOffset: row.char_offset ?? 0,
          percent: row.percent ?? 0,
          updatedAt: row.updated_at,
        }

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    language: row.language,
    sizeBytes: row.size_bytes,
    hasCover: Boolean(row.cover_key),
    addedAt: row.added_at,
    progress,
  }
}
