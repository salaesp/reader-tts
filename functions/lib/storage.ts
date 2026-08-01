import type { Env } from './env'

/**
 * Blob storage for EPUBs and covers, on top of Workers KV.
 *
 * KV — not R2 — because R2 requires a payment method on the account even for
 * the free tier. The surface here is deliberately narrow (put / get / delete by
 * key) so moving back to R2 is a rewrite of this file alone.
 *
 * What KV does not give us, and why it is acceptable here:
 *  - No range reads. The client downloads a whole EPUB in one request anyway.
 *  - No prefix listing of values, only of keys. Not needed: every key we read
 *    is recorded in D1.
 *  - A hard 25 MiB ceiling per value, enforced at upload time.
 */

/** KV rejects anything larger; the upload endpoint checks this before writing. */
export const MAX_VALUE_BYTES = 25 * 1024 * 1024

interface FileMetadata {
  contentType: string
  size: number
}

export interface StoredFile {
  body: ReadableStream
  contentType: string
  size: number
}

export async function putFile(
  env: Env,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const metadata: FileMetadata = { contentType, size: body.byteLength }
  await env.FILES.put(key, body, { metadata })
}

export async function getFile(env: Env, key: string): Promise<StoredFile | null> {
  const { value, metadata } = await env.FILES.getWithMetadata<FileMetadata>(key, { type: 'stream' })
  if (!value) return null

  return {
    body: value,
    contentType: metadata?.contentType ?? 'application/octet-stream',
    size: metadata?.size ?? 0,
  }
}

export async function deleteFiles(env: Env, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.FILES.delete(key)))
}
