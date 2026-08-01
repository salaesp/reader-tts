import type { SettingsUpdate, TtsProvider } from '../../shared/types'
import { DEFAULT_AUDIO_FORMAT, isTtsProvider } from '../../shared/types'
import type { Api } from '../lib/env'
import { HttpError, json, readJson, requireUser } from '../lib/http'
import { encryptSecret } from '../lib/crypto'
import type { SettingsRow } from '../lib/settings'
import { loadSettingsRow, providerOf, toSettings } from '../lib/settings'

export const onRequestGet: Api = async ({ env, data }) => {
  const user = requireUser(data.user)
  return json({ settings: toSettings(await loadSettingsRow(env, user.id)) })
}

export const onRequestPut: Api = async ({ request, env, data }) => {
  const user = requireUser(data.user)
  const body = await readJson<SettingsUpdate>(request)
  const current = await loadSettingsRow(env, user.id)

  const ttsProvider = isTtsProvider(body.ttsProvider) ? body.ttsProvider : providerOf(current)
  // A key, model or voice in the payload belongs to `provider` when given.
  // Without it they apply to whichever provider the request leaves active,
  // so the common case — change one thing on the current provider — needs no
  // extra field.
  const target: TtsProvider = isTtsProvider(body.provider) ? body.provider : ttsProvider

  const next: SettingsRow = {
    ...current,
    tts_provider: ttsProvider,
    speed: clampSpeed(body.speed ?? current.speed),
    ui_lang: body.uiLang === 'en' || body.uiLang === 'es' ? body.uiLang : current.ui_lang,
    reading_lang:
      body.readingLang === 'en' || body.readingLang === 'es'
        ? body.readingLang
        : current.reading_lang,
    use_browser_voice:
      typeof body.useBrowserVoice === 'boolean'
        ? Number(body.useBrowserVoice)
        : current.use_browser_voice,
  }

  if (target === 'elevenlabs') {
    next.elevenlabs_model = sanitizeString(body.ttsModel, current.elevenlabs_model, 128)
    // Unlike a model id, an empty voice is a legitimate state: it means the
    // account's voice list has not been read yet.
    next.elevenlabs_voice = sanitizeString(body.ttsVoice, current.elevenlabs_voice, 128, true)
  } else {
    next.tts_model = sanitizeString(body.ttsModel, current.tts_model, 128)
    next.tts_voice = sanitizeString(body.ttsVoice, current.tts_voice, 64)
    // Which formats a model accepts is a property of that model, so the
    // remembered value stops meaning anything the moment it changes. Back to
    // mp3, or a move away from a pcm-only model would keep paying for
    // uncompressed audio forever.
    if (next.tts_model !== current.tts_model) next.openrouter_audio_format = DEFAULT_AUDIO_FORMAT
  }

  if (body.apiKey === null) {
    setKey(next, target, null, null)
  } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    if (!env.ENCRYPTION_KEY) throw new HttpError(500, 'encryption_key_missing')
    const apiKey = body.apiKey.trim()
    setKey(next, target, await encryptSecret(env.ENCRYPTION_KEY, apiKey), apiKey.slice(-4))
  }

  await env.DB.prepare(
    `INSERT INTO settings (user_id, openrouter_key_enc, openrouter_key_hint, tts_model,
                           tts_voice, speed, ui_lang, reading_lang, use_browser_voice,
                           tts_provider, elevenlabs_key_enc, elevenlabs_key_hint,
                           elevenlabs_model, elevenlabs_voice,
                           openrouter_audio_format, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       openrouter_key_enc = excluded.openrouter_key_enc,
       openrouter_key_hint = excluded.openrouter_key_hint,
       tts_model = excluded.tts_model,
       tts_voice = excluded.tts_voice,
       speed = excluded.speed,
       ui_lang = excluded.ui_lang,
       reading_lang = excluded.reading_lang,
       use_browser_voice = excluded.use_browser_voice,
       tts_provider = excluded.tts_provider,
       elevenlabs_key_enc = excluded.elevenlabs_key_enc,
       elevenlabs_key_hint = excluded.elevenlabs_key_hint,
       elevenlabs_model = excluded.elevenlabs_model,
       elevenlabs_voice = excluded.elevenlabs_voice,
       openrouter_audio_format = excluded.openrouter_audio_format,
       updated_at = excluded.updated_at`,
  )
    .bind(
      user.id,
      next.openrouter_key_enc,
      next.openrouter_key_hint,
      next.tts_model,
      next.tts_voice,
      next.speed,
      next.ui_lang,
      next.reading_lang,
      next.use_browser_voice,
      next.tts_provider,
      next.elevenlabs_key_enc,
      next.elevenlabs_key_hint,
      next.elevenlabs_model,
      next.elevenlabs_voice,
      next.openrouter_audio_format,
      Date.now(),
    )
    .run()

  return json({ settings: toSettings(next) })
}

function setKey(
  row: SettingsRow,
  provider: TtsProvider,
  keyEnc: string | null,
  keyHint: string | null,
): void {
  if (provider === 'elevenlabs') {
    row.elevenlabs_key_enc = keyEnc
    row.elevenlabs_key_hint = keyHint
  } else {
    row.openrouter_key_enc = keyEnc
    row.openrouter_key_hint = keyHint
  }
}

function sanitizeString(
  value: unknown,
  fallback: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return allowEmpty ? '' : fallback
  if (trimmed.length > maxLength) throw new HttpError(400, 'value_too_long')
  return trimmed
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(0.5, Math.round(value * 100) / 100))
}
