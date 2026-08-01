import type { Settings } from '../../shared/types'
import { DEFAULT_SPEED, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } from '../../shared/types'
import type { Env } from './env'
import { decryptSecret } from './crypto'

export interface SettingsRow {
  openrouter_key_enc: string | null
  openrouter_key_hint: string | null
  tts_model: string
  tts_voice: string
  speed: number
  ui_lang: string
  reading_lang: string
  use_browser_voice: number
}

export async function loadSettingsRow(env: Env, userId: string): Promise<SettingsRow> {
  const row = await env.DB.prepare(
    `SELECT openrouter_key_enc, openrouter_key_hint, tts_model, tts_voice,
            speed, ui_lang, reading_lang, use_browser_voice
       FROM settings WHERE user_id = ?`,
  )
    .bind(userId)
    .first<SettingsRow>()

  return (
    row ?? {
      openrouter_key_enc: null,
      openrouter_key_hint: null,
      tts_model: DEFAULT_TTS_MODEL,
      tts_voice: DEFAULT_TTS_VOICE,
      speed: DEFAULT_SPEED,
      ui_lang: 'es',
      reading_lang: 'es',
      use_browser_voice: 0,
    }
  )
}

export function toSettings(row: SettingsRow): Settings {
  return {
    hasApiKey: Boolean(row.openrouter_key_enc),
    apiKeyHint: row.openrouter_key_hint,
    ttsModel: row.tts_model,
    ttsVoice: row.tts_voice,
    speed: row.speed,
    uiLang: row.ui_lang === 'en' ? 'en' : 'es',
    readingLang: row.reading_lang === 'en' ? 'en' : 'es',
    useBrowserVoice: row.use_browser_voice === 1,
  }
}

/** Returns the user's decrypted OpenRouter key, or null when none is stored. */
export async function getApiKey(env: Env, userId: string): Promise<string | null> {
  const row = await loadSettingsRow(env, userId)
  if (!row.openrouter_key_enc) return null
  return decryptSecret(env.ENCRYPTION_KEY, row.openrouter_key_enc)
}
