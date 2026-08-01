/** Base64url / AES-GCM / HMAC helpers built on Web Crypto (available in Workers). */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64UrlDecodeText(value: string): string {
  return decoder.decode(base64UrlDecode(value))
}

/** Constant-time comparison, so signature checks do not leak timing. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function hmacKey(secret: string, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return base64UrlEncode(signature)
}

export async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, message)
  return timingSafeEqual(base64UrlDecode(expected), base64UrlDecode(signature))
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function aesKey(encryptionKey: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(encryptionKey.replace(/\+/g, '-').replace(/\//g, '_'))
  if (raw.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Returns `iv.ciphertext`, both base64url. */
export async function encryptSecret(encryptionKey: string, plaintext: string): Promise<string> {
  const key = await aesKey(encryptionKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )
  return `${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`
}

export async function decryptSecret(encryptionKey: string, stored: string): Promise<string> {
  const [ivPart, dataPart] = stored.split('.')
  if (!ivPart || !dataPart) throw new Error('malformed ciphertext')
  const key = await aesKey(encryptionKey)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivPart) as BufferSource },
    key,
    base64UrlDecode(dataPart) as BufferSource,
  )
  return decoder.decode(plaintext)
}
