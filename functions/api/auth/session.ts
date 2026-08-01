import type { Api, SessionUser } from '../../lib/env'
import { HttpError, json, readJson, requireUser } from '../../lib/http'
import { verifyGoogleIdToken } from '../../lib/google'
import {
  clearSessionCookieHeader,
  createSessionToken,
  sessionCookieHeader,
} from '../../lib/session'

interface LoginBody {
  idToken?: string
}

/** Current session, or 401 when signed out. */
export const onRequestGet: Api = ({ data }) => {
  const user = requireUser(data.user)
  return json({ user })
}

/** Exchanges a Google ID token for a first-party session cookie. */
export const onRequestPost: Api = async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'google_not_configured')
  if (!env.SESSION_SECRET) throw new HttpError(500, 'session_secret_missing')

  const body = await readJson<LoginBody>(request)
  if (!body.idToken) throw new HttpError(400, 'missing_id_token')

  let claims
  try {
    claims = await verifyGoogleIdToken(body.idToken, env.GOOGLE_CLIENT_ID)
  } catch (err) {
    throw new HttpError(401, 'invalid_id_token', err instanceof Error ? err.message : undefined)
  }

  const now = Date.now()
  const name = claims.name ?? claims.given_name ?? claims.email.split('@')[0]
  const picture = claims.picture ?? null

  // The user id is derived from Google's stable subject id, so repeated logins
  // land on the same row without a second round trip to read it back.
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
    .bind(claims.sub)
    .first<{ id: string }>()

  const userId = existing?.id ?? crypto.randomUUID()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, name, picture, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture,
         last_seen_at = excluded.last_seen_at`,
    ).bind(userId, claims.sub, claims.email, name, picture, now, now),
    env.DB.prepare(
      `INSERT INTO settings (user_id, ui_lang, reading_lang, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    ).bind(userId, 'es', 'es', now),
  ])

  const user: SessionUser = { id: userId, email: claims.email, name, picture }
  const token = await createSessionToken(env.SESSION_SECRET, user)
  const url = new URL(request.url)

  return json({ user }, { headers: { 'set-cookie': sessionCookieHeader(token, url) } })
}

export const onRequestDelete: Api = ({ request }) => {
  const url = new URL(request.url)
  return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookieHeader(url) } })
}
