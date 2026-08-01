import type { Settings, TtsProvider } from '../../shared/types'
import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE,
  DEFAULT_SPEED,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_PROVIDER,
  DEFAULT_TTS_VOICE,
  isTtsProvider,
} from '../../shared/types'
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
  tts_provider: string
  elevenlabs_key_enc: string | null
  elevenlabs_key_hint: string | null
  elevenlabs_model: string
  elevenlabs_voice: string
}

/** Column names differ per provider; everything else about them is identical. */
const COLUMNS: Record<
  TtsProvider,
  { keyEnc: keyof SettingsRow; keyHint: keyof SettingsRow; model: keyof SettingsRow; voice: keyof SettingsRow }
> = {
  openrouter: {
    keyEnc: 'openrouter_key_enc',
    keyHint: 'openrouter_key_hint',
    model: 'tts_model',
    voice: 'tts_voice',
  },
  elevenlabs: {
    keyEnc: 'elevenlabs_key_enc',
    keyHint: 'elevenlabs_key_hint',
    model: 'elevenlabs_model',
    voice: 'elevenlabs_voice',
  },
}

export function defaultSettingsRow(): SettingsRow {
  return {
    openrouter_key_enc: null,
    openrouter_key_hint: null,
    tts_model: DEFAULT_TTS_MODEL,
    tts_voice: DEFAULT_TTS_VOICE,
    speed: DEFAULT_SPEED,
    ui_lang: 'es',
    reading_lang: 'es',
    use_browser_voice: 0,
    tts_provider: DEFAULT_TTS_PROVIDER,
    elevenlabs_key_enc: null,
    elevenlabs_key_hint: null,
    elevenlabs_model: DEFAULT_ELEVENLABS_MODEL,
    elevenlabs_voice: DEFAULT_ELEVENLABS_VOICE,
  }
}

export async function loadSettingsRow(env: Env, userId: string): Promise<SettingsRow> {
  const row = await env.DB.prepare(
    `SELECT openrouter_key_enc, openrouter_key_hint, tts_model, tts_voice,
            speed, ui_lang, reading_lang, use_browser_voice,
            tts_provider, elevenlabs_key_enc, elevenlabs_key_hint,
            elevenlabs_model, elevenlabs_voice
       FROM settings WHERE user_id = ?`,
  )
    .bind(userId)
    .first<SettingsRow>()

  return row ?? defaultSettingsRow()
}

export function providerOf(row: SettingsRow): TtsProvider {
  return isTtsProvider(row.tts_provider) ? row.tts_provider : DEFAULT_TTS_PROVIDER
}

export function modelOf(row: SettingsRow, provider: TtsProvider): string {
  return (row[COLUMNS[provider].model] as string) || defaultModel(provider)
}

export function voiceOf(row: SettingsRow, provider: TtsProvider): string {
  return (row[COLUMNS[provider].voice] as string) ?? ''
}

function defaultModel(provider: TtsProvider): string {
  return provider === 'elevenlabs' ? DEFAULT_ELEVENLABS_MODEL : DEFAULT_TTS_MODEL
}

export function toSettings(row: SettingsRow): Settings {
  return {
    ttsProvider: providerOf(row),
    providers: {
      openrouter: {
        hasApiKey: Boolean(row.openrouter_key_enc),
        apiKeyHint: row.openrouter_key_hint,
        model: modelOf(row, 'openrouter'),
        voice: voiceOf(row, 'openrouter'),
      },
      elevenlabs: {
        hasApiKey: Boolean(row.elevenlabs_key_enc),
        apiKeyHint: row.elevenlabs_key_hint,
        model: modelOf(row, 'elevenlabs'),
        voice: voiceOf(row, 'elevenlabs'),
      },
    },
    speed: row.speed,
    uiLang: row.ui_lang === 'en' ? 'en' : 'es',
    readingLang: row.reading_lang === 'en' ? 'en' : 'es',
    useBrowserVoice: row.use_browser_voice === 1,
  }
}

/** Returns the user's decrypted key for a provider, or null when none is stored. */
export async function getApiKey(
  env: Env,
  userId: string,
  provider: TtsProvider,
): Promise<string | null> {
  const row = await loadSettingsRow(env, userId)
  return getApiKeyFromRow(env, row, provider)
}

export async function getApiKeyFromRow(
  env: Env,
  row: SettingsRow,
  provider: TtsProvider,
): Promise<string | null> {
  const ciphertext = row[COLUMNS[provider].keyEnc] as string | null
  if (!ciphertext) return null
  return decryptSecret(env.ENCRYPTION_KEY, ciphertext)
}
