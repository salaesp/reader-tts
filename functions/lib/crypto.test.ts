import { describe, expect, it } from 'vitest'
import {
  base64UrlDecode,
  base64UrlEncode,
  decryptSecret,
  encryptSecret,
  hmacSign,
  hmacVerify,
  sha256Hex,
  timingSafeEqual,
} from './crypto'
import { createSessionToken, verifySessionToken } from './session'

const KEY = base64UrlEncode(new Uint8Array(32).fill(7))
const SECRET = 'test-session-secret'

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63])

    expect([...base64UrlDecode(base64UrlEncode(bytes))]).toEqual([...bytes])
  })

  it('emits no padding or URL-unsafe characters', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 239, 1]))

    expect(encoded).not.toMatch(/[+/=]/)
  })
})

describe('timingSafeEqual', () => {
  it('matches identical buffers', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
  })

  it('rejects different contents and different lengths', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
  })
})

describe('encryptSecret / decryptSecret', () => {
  it('round-trips an API key', async () => {
    const apiKey = 'sk-or-v1-0123456789abcdef0123456789abcdef'

    expect(await decryptSecret(KEY, await encryptSecret(KEY, apiKey))).toBe(apiKey)
  })

  it('never stores the plaintext', async () => {
    const apiKey = 'sk-or-v1-supersecret'

    expect(await encryptSecret(KEY, apiKey)).not.toContain('supersecret')
  })

  it('produces a different ciphertext each time', async () => {
    const first = await encryptSecret(KEY, 'same-input')
    const second = await encryptSecret(KEY, 'same-input')

    expect(first).not.toBe(second)
    expect(await decryptSecret(KEY, first)).toBe(await decryptSecret(KEY, second))
  })

  it('fails to decrypt with the wrong key', async () => {
    const other = base64UrlEncode(new Uint8Array(32).fill(9))
    const ciphertext = await encryptSecret(KEY, 'secret')

    await expect(decryptSecret(other, ciphertext)).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const ciphertext = await encryptSecret(KEY, 'secret')
    const [iv, data] = ciphertext.split('.')
    const tampered = `${iv}.${data.slice(0, -2)}${data.slice(-2) === 'AA' ? 'BB' : 'AA'}`

    await expect(decryptSecret(KEY, tampered)).rejects.toThrow()
  })

  it('rejects a key that is not 32 bytes', async () => {
    await expect(encryptSecret(base64UrlEncode(new Uint8Array(16)), 'x')).rejects.toThrow(
      /32 bytes/,
    )
  })

  it('rejects malformed stored values', async () => {
    await expect(decryptSecret(KEY, 'no-separator')).rejects.toThrow(/malformed/)
  })

  it('handles unicode', async () => {
    const value = 'ключ-señor-鍵-🔑'

    expect(await decryptSecret(KEY, await encryptSecret(KEY, value))).toBe(value)
  })
})

describe('hmac', () => {
  it('verifies its own signature', async () => {
    const signature = await hmacSign(SECRET, 'payload')

    expect(await hmacVerify(SECRET, 'payload', signature)).toBe(true)
  })

  it('rejects a signature from another secret or message', async () => {
    const signature = await hmacSign(SECRET, 'payload')

    expect(await hmacVerify('other-secret', 'payload', signature)).toBe(false)
    expect(await hmacVerify(SECRET, 'tampered', signature)).toBe(false)
  })
})

describe('sha256Hex', () => {
  it('matches the known digest of an empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('session tokens', () => {
  const user = { id: 'u1', email: 'a@b.com', name: 'Ana', picture: null }

  it('round-trips the session user', async () => {
    const token = await createSessionToken(SECRET, user)

    expect(await verifySessionToken(SECRET, token)).toEqual(user)
  })

  it('rejects a token signed with another secret', async () => {
    const token = await createSessionToken('attacker-secret', user)

    expect(await verifySessionToken(SECRET, token)).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const [header, , signature] = (await createSessionToken(SECRET, user)).split('.')
    const forged = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({ ...user, id: 'someone-else', exp: Math.floor(Date.now() / 1000) + 60 }),
      ),
    )

    expect(await verifySessionToken(SECRET, `${header}.${forged}.${signature}`)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const header = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    )
    const body = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify({ ...user, iat: now - 120, exp: now - 60 })),
    )
    const signature = await hmacSign(SECRET, `${header}.${body}`)

    expect(await verifySessionToken(SECRET, `${header}.${body}.${signature}`)).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await verifySessionToken(SECRET, 'not.a.valid.token')).toBeNull()
    expect(await verifySessionToken(SECRET, 'garbage')).toBeNull()
  })
})
