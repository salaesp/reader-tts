/**
 * Mints a session cookie for local testing, so the API can be exercised before
 * Google OAuth credentials exist. Uses the same HS256 scheme as
 * functions/lib/session.ts, signed with the SESSION_SECRET from .dev.vars.
 *
 * This only produces a cookie your own local Worker will accept — a deployed
 * environment has a different secret and rejects it.
 *
 *   node scripts/dev/mint-session.mjs [userId]
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

function readDevVar(name) {
  const fromEnv = process.env[name]
  if (fromEnv) return fromEnv
  try {
    const contents = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8')
    const match = new RegExp(`^${name}\\s*=\\s*"?([^"\n]+)"?`, 'm').exec(contents)
    if (match) return match[1]
  } catch {
    // fall through
  }
  throw new Error(`${name} not found — set it in .dev.vars or the environment`)
}

const secret = readDevVar('SESSION_SECRET')
const userId = process.argv[2] ?? 'dev-user'
const b64 = (value) => Buffer.from(value).toString('base64url')

const now = Math.floor(Date.now() / 1000)
const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const body = b64(
  JSON.stringify({
    id: userId,
    email: `${userId}@example.com`,
    name: 'Dev User',
    picture: null,
    iat: now,
    exp: now + 60 * 60 * 24,
  }),
)
const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')

process.stdout.write(`${header}.${body}.${signature}\n`)
