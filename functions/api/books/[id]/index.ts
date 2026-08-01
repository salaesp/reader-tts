import type { Api } from '../../../lib/env'
import { HttpError, json, requireUser } from '../../../lib/http'
import { rowToBook } from '../index'

interface Row {
  id: string
  title: string
  author: string | null
  language: string | null
  size_bytes: number
  cover_key: string | null
  r2_key: string
  added_at: number
  chapter_index: number | null
  chunk_index: number | null
  char_offset: number | null
  percent: number | null
  updated_at: number | null
}

export const onRequestGet: Api<'id'> = async ({ env, data, params }) => {
  const user = requireUser(data.user)
  const bookId = String(params.id)

  const row = await env.DB.prepare(
    `SELECT b.id, b.title, b.author, b.language, b.size_bytes, b.cover_key, b.r2_key, b.added_at,
            p.chapter_index, p.chunk_index, p.char_offset, p.percent, p.updated_at
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = b.user_id
      WHERE b.id = ? AND b.user_id = ?`,
  )
    .bind(bookId, user.id)
    .first<Row>()

  if (!row) throw new HttpError(404, 'book_not_found')
  return json({ book: rowToBook(row) })
}

export const onRequestDelete: Api<'id'> = async ({ env, data, params }) => {
  const user = requireUser(data.user)
  const bookId = String(params.id)

  const row = await env.DB.prepare(
    'SELECT r2_key, cover_key FROM books WHERE id = ? AND user_id = ?',
  )
    .bind(bookId, user.id)
    .first<{ r2_key: string; cover_key: string | null }>()

  if (!row) throw new HttpError(404, 'book_not_found')

  await env.DB.batch([
    env.DB.prepare('DELETE FROM progress WHERE book_id = ? AND user_id = ?').bind(bookId, user.id),
    env.DB.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').bind(bookId, user.id),
  ])

  const keys = row.cover_key ? [row.r2_key, row.cover_key] : [row.r2_key]
  await env.BUCKET.delete(keys)
  await deleteAudioCache(env.BUCKET, `audio/${user.id}/${bookId}/`)

  return json({ ok: true })
}

/** Removes every cached audio chunk generated for a book. */
async function deleteAudioCache(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const listing = await bucket.list({ prefix, cursor, limit: 1000 })
    if (listing.objects.length > 0) {
      await bucket.delete(listing.objects.map((object) => object.key))
    }
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)
}
