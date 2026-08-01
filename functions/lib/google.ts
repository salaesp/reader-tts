import { base64UrlDecode, base64UrlDecodeText } from './crypto'

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

interface JwtHeader {
  alg: string
  kid: string
}

export interface GoogleIdToken {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  given_name?: string
  picture?: string
  aud: string
  iss: string
  exp: number
  iat: number
}

interface Jwk {
  kid: string
  kty: string
  alg?: string
  use?: string
  n: string
  e: string
}

/** Per-isolate memo on top of the edge cache; the certs rotate slowly. */
let cachedKeys: { keys: Jwk[]; expiresAt: number } | null = null

async function fetchGoogleKeys(): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys

  const response = await fetch(CERTS_URL, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit)
  if (!response.ok) throw new Error(`google certs fetch failed: ${response.status}`)

  const body = (await response.json()) as { keys: Jwk[] }
  cachedKeys = { keys: body.keys, expiresAt: Date.now() + 60 * 60 * 1000 }
  return body.keys
}

/**
 * Verifies a Google-issued ID token: RS256 signature against Google's JWKS,
 * plus issuer, audience and expiry.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleIdToken> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('malformed id_token')
  const [headerPart, payloadPart, signaturePart] = parts

  const header = JSON.parse(base64UrlDecodeText(headerPart)) as JwtHeader
  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg}`)

  const keys = await fetchGoogleKeys()
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('signing key not found')

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(signaturePart) as BufferSource,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  )
  if (!valid) throw new Error('invalid signature')

  const payload = JSON.parse(base64UrlDecodeText(payloadPart)) as GoogleIdToken
  if (!VALID_ISSUERS.has(payload.iss)) throw new Error(`unexpected issuer: ${payload.iss}`)
  if (payload.aud !== clientId) throw new Error('audience mismatch')

  const now = Math.floor(Date.now() / 1000)
  // 60s of leeway for clock skew between Google and the edge.
  if (payload.exp < now - 60) throw new Error('token expired')
  if (payload.iat > now + 60) throw new Error('token issued in the future')
  if (payload.email_verified === false) throw new Error('email not verified')

  return payload
}
