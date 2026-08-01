import type { Progress } from '../../../../shared/types'
import type { Api } from '../../../lib/env'
import { HttpError, json, readJson, requireUser } from '../../../lib/http'

interface ProgressRow {
  chapter_index: number
  chunk_index: number
  char_offset: number
  percent: number
  updated_at: number
}

export const onRequestGet: Api<'id'> = async ({ env, data, params }) => {
  const user = requireUser(data.user)
  const row = await env.DB.prepare(
    `SELECT chapter_index, chunk_index, char_offset, percent, updated_at
       FROM progress WHERE user_id = ? AND book_id = ?`,
  )
    .bind(user.id, String(params.id))
    .first<ProgressRow>()

  return json({ progress: row ? toProgress(row) : null })
}

export const onRequestPut: Api<'id'> = async ({ request, env, data, params }) => {
  const user = requireUser(data.user)
  const bookId = String(params.id)
  const body = await readJson<Partial<Progress>>(request)

  const owns = await env.DB.prepare('SELECT 1 AS ok FROM books WHERE id = ? AND user_id = ?')
    .bind(bookId, user.id)
    .first<{ ok: number }>()
  if (!owns) throw new HttpError(404, 'book_not_found')

  const chapterIndex = nonNegativeInt(body.chapterIndex)
  const chunkIndex = nonNegativeInt(body.chunkIndex)
  const charOffset = nonNegativeInt(body.charOffset)
  const percent = Math.min(100, Math.max(0, Number(body.percent) || 0))
  // The client's timestamp wins so that an offline device syncing later cannot
  // overwrite newer progress made elsewhere.
  const updatedAt = Number.isFinite(body.updatedAt) ? Number(body.updatedAt) : Date.now()

  await env.DB.prepare(
    `INSERT INTO progress (user_id, book_id, chapter_index, chunk_index, char_offset, percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, book_id) DO UPDATE SET
       chapter_index = excluded.chapter_index,
       chunk_index = excluded.chunk_index,
       char_offset = excluded.char_offset,
       percent = excluded.percent,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= progress.updated_at`,
  )
    .bind(user.id, bookId, chapterIndex, chunkIndex, charOffset, percent, updatedAt)
    .run()

  const row = await env.DB.prepare(
    `SELECT chapter_index, chunk_index, char_offset, percent, updated_at
       FROM progress WHERE user_id = ? AND book_id = ?`,
  )
    .bind(user.id, bookId)
    .first<ProgressRow>()

  return json({ progress: row ? toProgress(row) : null })
}

function toProgress(row: ProgressRow): Progress {
  return {
    chapterIndex: row.chapter_index,
    chunkIndex: row.chunk_index,
    charOffset: row.char_offset,
    percent: row.percent,
    updatedAt: row.updated_at,
  }
}

function nonNegativeInt(value: unknown): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}
