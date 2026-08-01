import type { Api } from '../../../lib/env'
import { HttpError, requireUser } from '../../../lib/http'

export const onRequestGet: Api<'id'> = async ({ env, data, params }) => {
  const user = requireUser(data.user)

  const row = await env.DB.prepare('SELECT cover_key FROM books WHERE id = ? AND user_id = ?')
    .bind(String(params.id), user.id)
    .first<{ cover_key: string | null }>()
  if (!row?.cover_key) throw new HttpError(404, 'cover_not_found')

  const object = await env.BUCKET.get(row.cover_key)
  if (!object) throw new HttpError(404, 'cover_not_found')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  return new Response(object.body, { headers })
}
