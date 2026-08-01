import { base64UrlDecodeText, base64UrlEncode, hmacSign, hmacVerify } from './crypto'
import type { SessionUser } from './env'

export const SESSION_COOKIE = 'rt_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

interface SessionPayload extends SessionUser {
  iat: number
  exp: number
}

const encoder = new TextEncoder()

/** Signs a compact HS256 token holding the session user. */
export async function createSessionToken(secret: string, user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = { ...user, iat: now, exp: now + SESSION_TTL_SECONDS }
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const signature = await hmacSign(secret, `${header}.${body}`)
  return `${header}.${body}.${signature}`
}

export async function verifySessionToken(
  secret: string,
  token: string,
): Promise<SessionUser | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  if (!(await hmacVerify(secret, `${header}.${body}`, signature))) return null

  let payload: SessionPayload
  try {
    payload = JSON.parse(base64UrlDecodeText(body)) as SessionPayload
  } catch {
    return null
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  if (!payload.id || !payload.email) return null

  return {
    id: payload.id,
    email: payload.email,
    name: payload.name ?? '',
    picture: payload.picture ?? null,
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export function sessionCookieHeader(token: string, url: URL): string {
  // `wrangler pages dev` serves over plain http on localhost, where a Secure
  // cookie would be dropped by the browser.
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`
}

export function clearSessionCookieHeader(url: URL): string {
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}
