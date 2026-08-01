import type { TtsVoice } from '../../../shared/types'

/**
 * Finds the voice list inside an OpenRouter model entry.
 *
 * Voices are not in the documented model schema, and they are namespaced per
 * provider — `Kore` is Google's, `alloy` is OpenAI's, `af_bella` is Kokoro's —
 * so a wrong one is a 400 with no indication that the voice was the problem.
 * Inferring the list from the model id only ever covered the two providers
 * someone had written lists for.
 *
 * Rather than commit to one path that may not exist and will not survive a
 * schema change, this scans the entry for any key that looks like a voice
 * collection and holds something voice-shaped. Finding nothing is an ordinary
 * outcome: the caller falls back to inference.
 */

/** Depth is bounded because the input is untrusted third-party JSON. */
const MAX_DEPTH = 6
const VOICE_KEY = /(^|_)voices?$/i

export function findVoices(model: unknown): TtsVoice[] {
  const found = search(model, 0)
  return found ? dedupe(found) : []
}

function search(value: unknown, depth: number): TtsVoice[] | null {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return null

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = search(item, depth + 1)
      if (nested) return nested
    }
    return null
  }

  const entries = Object.entries(value as Record<string, unknown>)

  // A key that names voices wins over anything nested inside a sibling.
  for (const [key, child] of entries) {
    if (!VOICE_KEY.test(key)) continue
    const voices = toVoices(child)
    if (voices.length > 0) return voices
  }

  for (const [, child] of entries) {
    const nested = search(child, depth + 1)
    if (nested) return nested
  }
  return null
}

/**
 * Accepts the shapes a voice list plausibly takes: bare names, objects keyed
 * by id or name, or an id-to-label map.
 */
function toVoices(value: unknown): TtsVoice[] {
  if (Array.isArray(value)) {
    return value.map(toVoice).filter((voice): voice is TtsVoice => voice !== null)
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([id, label]) => ({ id, name: typeof label === 'string' && label ? label : id }))
      .filter((voice) => voice.id.length > 0)
  }

  return []
}

function toVoice(entry: unknown): TtsVoice | null {
  if (typeof entry === 'string') {
    return entry.trim() ? { id: entry, name: entry } : null
  }
  if (entry === null || typeof entry !== 'object') return null

  const record = entry as Record<string, unknown>
  const id = firstString(record, ['id', 'voice', 'voice_id', 'name', 'slug'])
  if (!id) return null

  const label = firstString(record, ['name', 'label', 'display_name', 'title'])
  return { id, name: label ?? id }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function dedupe(voices: TtsVoice[]): TtsVoice[] {
  const seen = new Map<string, TtsVoice>()
  for (const voice of voices) if (!seen.has(voice.id)) seen.set(voice.id, voice)
  return [...seen.values()]
}
