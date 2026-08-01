import type { Api } from '../../../lib/env'
import { HttpError, requireUser } from '../../../lib/http'
import { getFile } from '../../../lib/storage'

export const onRequestGet: Api<'id'> = async ({ env, data, params }) => {
  const user = requireUser(data.user)

  const row = await env.DB.prepare('SELECT cover_key FROM books WHERE id = ? AND user_id = ?')
    .bind(String(params.id), user.id)
    .first<{ cover_key: string | null }>()
  if (!row?.cover_key) throw new HttpError(404, 'cover_not_found')

  const file = await getFile(env, row.cover_key)
  if (!file) throw new HttpError(404, 'cover_not_found')

  const headers = new Headers()
  headers.set('content-type', file.contentType)
  headers.set('content-length', String(file.size))
  headers.set('etag', `"${row.cover_key}"`)
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  return new Response(file.body, { headers })
}
