import type { Api } from '../../../lib/env'
import { HttpError, requireUser } from '../../../lib/http'
import { getFile } from '../../../lib/storage'

/**
 * Streams the stored EPUB back to the client.
 *
 * No Range support: the storage backend cannot serve partial reads, and the
 * client fetches the whole file in one request. Advertising `accept-ranges`
 * without honouring it would be worse than staying silent.
 */
export const onRequestGet: Api<'id'> = async ({ env, data, params }) => {
  const user = requireUser(data.user)
  const bookId = String(params.id)

  const row = await env.DB.prepare('SELECT r2_key FROM books WHERE id = ? AND user_id = ?')
    .bind(bookId, user.id)
    .first<{ r2_key: string }>()
  if (!row) throw new HttpError(404, 'book_not_found')

  const file = await getFile(env, row.r2_key)
  if (!file) throw new HttpError(404, 'file_not_found')

  const headers = new Headers()
  headers.set('content-type', 'application/epub+zip')
  headers.set('content-length', String(file.size))
  // The key embeds a uuid and the bytes never change, so it doubles as an etag.
  headers.set('etag', `"${row.r2_key}"`)
  headers.set('cache-control', 'private, max-age=31536000, immutable')

  return new Response(file.body, { headers })
}
