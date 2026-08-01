import { describe, expect, it } from 'vitest'
import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_TTS_MODEL } from '../../shared/types'
import type { SettingsRow } from './settings'
import { defaultSettingsRow, modelOf, providerOf, toSettings, voiceOf } from './settings'

function row(overrides: Partial<SettingsRow> = {}): SettingsRow {
  return { ...defaultSettingsRow(), ...overrides }
}

describe('providerOf', () => {
  it('defaults to OpenRouter when the column holds something unknown', () => {
    // Rows written before the provider column existed read back as ''.
    expect(providerOf(row({ tts_provider: '' }))).toBe('openrouter')
    expect(providerOf(row({ tts_provider: 'azure' }))).toBe('openrouter')
  })

  it('accepts a known provider', () => {
    expect(providerOf(row({ tts_provider: 'elevenlabs' }))).toBe('elevenlabs')
  })
})

describe('modelOf / voiceOf', () => {
  it('reads each provider from its own columns', () => {
    const stored = row({
      tts_model: 'openai/gpt-4o-mini-tts',
      tts_voice: 'nova',
      elevenlabs_model: 'eleven_turbo_v2_5',
      elevenlabs_voice: 'voice-123',
    })

    expect(modelOf(stored, 'openrouter')).toBe('openai/gpt-4o-mini-tts')
    expect(voiceOf(stored, 'openrouter')).toBe('nova')
    expect(modelOf(stored, 'elevenlabs')).toBe('eleven_turbo_v2_5')
    expect(voiceOf(stored, 'elevenlabs')).toBe('voice-123')
  })

  it('falls back to the provider default for an empty model', () => {
    const stored = row({ tts_model: '', elevenlabs_model: '' })

    expect(modelOf(stored, 'openrouter')).toBe(DEFAULT_TTS_MODEL)
    expect(modelOf(stored, 'elevenlabs')).toBe(DEFAULT_ELEVENLABS_MODEL)
  })

  // Unlike a model, no voice is a real state: ids are per account and Settings
  // fills it in from the first one the account exposes.
  it('leaves an unset voice empty', () => {
    expect(voiceOf(row({ elevenlabs_voice: '' }), 'elevenlabs')).toBe('')
  })
})

describe('toSettings', () => {
  it('reports each provider key independently and never leaks the ciphertext', () => {
    const settings = toSettings(
      row({
        tts_provider: 'elevenlabs',
        openrouter_key_enc: 'cipher-a',
        openrouter_key_hint: 'aaaa',
        elevenlabs_key_enc: null,
      }),
    )

    expect(settings.ttsProvider).toBe('elevenlabs')
    expect(settings.providers.openrouter).toMatchObject({ hasApiKey: true, apiKeyHint: 'aaaa' })
    expect(settings.providers.elevenlabs.hasApiKey).toBe(false)
    expect(JSON.stringify(settings)).not.toContain('cipher-a')
  })

  it('carries the shared preferences through', () => {
    const settings = toSettings(
      row({ speed: 1.25, ui_lang: 'en', reading_lang: 'en', use_browser_voice: 1 }),
    )

    expect(settings).toMatchObject({
      speed: 1.25,
      uiLang: 'en',
      readingLang: 'en',
      useBrowserVoice: true,
    })
  })
})
