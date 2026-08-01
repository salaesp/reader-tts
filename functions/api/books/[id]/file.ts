import type { Api } from '../../../lib/env'
import { HttpError, requireUser } from '../../../lib/http'

/** Streams the stored EPUB back to the client, with Range support for resumes. */
export const onRequestGet: Api<'id'> = async ({ request, env, data, params }) => {
  const user = requireUser(data.user)
  const bookId = String(params.id)

  const row = await env.DB.prepare('SELECT r2_key FROM books WHERE id = ? AND user_id = ?')
    .bind(bookId, user.id)
    .first<{ r2_key: string }>()
  if (!row) throw new HttpError(404, 'book_not_found')

  const range = request.headers.get('range')
  const object = await env.BUCKET.get(row.r2_key, range ? { range: request.headers } : undefined)
  if (!object) throw new HttpError(404, 'file_not_found')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('content-type', 'application/epub+zip')
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  headers.set('accept-ranges', 'bytes')

  const body = 'body' in object ? object.body : null
  if (!body) throw new HttpError(404, 'file_not_found')

  if (object.range && 'offset' in object.range) {
    const offset = object.range.offset ?? 0
    const length = object.range.length ?? object.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    return new Response(body, { status: 206, headers })
  }

  return new Response(body, { headers })
}
