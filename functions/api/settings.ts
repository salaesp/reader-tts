import type { SettingsUpdate } from '../../shared/types'
import type { Api } from '../lib/env'
import { HttpError, json, readJson, requireUser } from '../lib/http'
import { encryptSecret } from '../lib/crypto'
import { loadSettingsRow, toSettings } from '../lib/settings'

export const onRequestGet: Api = async ({ env, data }) => {
  const user = requireUser(data.user)
  return json({ settings: toSettings(await loadSettingsRow(env, user.id)) })
}

export const onRequestPut: Api = async ({ request, env, data }) => {
  const user = requireUser(data.user)
  const body = await readJson<SettingsUpdate>(request)
  const current = await loadSettingsRow(env, user.id)

  let keyEnc = current.openrouter_key_enc
  let keyHint = current.openrouter_key_hint

  if (body.apiKey === null) {
    keyEnc = null
    keyHint = null
  } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    if (!env.ENCRYPTION_KEY) throw new HttpError(500, 'encryption_key_missing')
    const apiKey = body.apiKey.trim()
    keyEnc = await encryptSecret(env.ENCRYPTION_KEY, apiKey)
    keyHint = apiKey.slice(-4)
  }

  const ttsModel = sanitizeString(body.ttsModel, current.tts_model, 128)
  const ttsVoice = sanitizeString(body.ttsVoice, current.tts_voice, 64)
  const speed = clampSpeed(body.speed ?? current.speed)
  const uiLang = body.uiLang === 'en' || body.uiLang === 'es' ? body.uiLang : current.ui_lang
  const readingLang =
    body.readingLang === 'en' || body.readingLang === 'es' ? body.readingLang : current.reading_lang
  const useBrowserVoice =
    typeof body.useBrowserVoice === 'boolean'
      ? Number(body.useBrowserVoice)
      : current.use_browser_voice

  await env.DB.prepare(
    `INSERT INTO settings (user_id, openrouter_key_enc, openrouter_key_hint, tts_model,
                           tts_voice, speed, ui_lang, reading_lang, use_browser_voice, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       openrouter_key_enc = excluded.openrouter_key_enc,
       openrouter_key_hint = excluded.openrouter_key_hint,
       tts_model = excluded.tts_model,
       tts_voice = excluded.tts_voice,
       speed = excluded.speed,
       ui_lang = excluded.ui_lang,
       reading_lang = excluded.reading_lang,
       use_browser_voice = excluded.use_browser_voice,
       updated_at = excluded.updated_at`,
  )
    .bind(
      user.id,
      keyEnc,
      keyHint,
      ttsModel,
      ttsVoice,
      speed,
      uiLang,
      readingLang,
      useBrowserVoice,
      Date.now(),
    )
    .run()

  return json({
    settings: toSettings({
      openrouter_key_enc: keyEnc,
      openrouter_key_hint: keyHint,
      tts_model: ttsModel,
      tts_voice: ttsVoice,
      speed,
      ui_lang: uiLang,
      reading_lang: readingLang,
      use_browser_voice: useBrowserVoice,
    }),
  })
}

function sanitizeString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  if (trimmed.length > maxLength) throw new HttpError(400, 'value_too_long')
  return trimmed
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(0.5, Math.round(value * 100) / 100))
}
