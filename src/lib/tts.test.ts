import { describe, expect, it } from 'vitest'
import type { TtsModel } from '../../shared/types'
import { OPENAI_VOICES } from '../../shared/types'
import { voicesFor } from './tts'

function model(id: string, voices: string[] = []): TtsModel {
  return { id, name: id, pricing: null, voices: voices.map((v) => ({ id: v, name: v })) }
}

describe('voicesFor', () => {
  it('prefers the voices the selected model advertises', () => {
    const models = [model('a', ['one']), model('b', ['two'])]

    expect(voicesFor('openrouter', models, 'b')).toEqual([{ id: 'two', name: 'two' }])
  })

  // Voices are an ElevenLabs account's property, so a model id the catalogue
  // does not know about must still get the account's real voices instead of
  // dropping the user into a field where they'd have to paste a raw voice id.
  it('keeps the account voices for an ElevenLabs model typed by hand', () => {
    const models = [model('eleven_multilingual_v2', ['Bella', 'Rachel'])]

    expect(voicesFor('elevenlabs', models, 'eleven_v3_alpha')).toEqual([
      { id: 'Bella', name: 'Bella' },
      { id: 'Rachel', name: 'Rachel' },
    ])
  })

  it('has nothing to offer for ElevenLabs before the catalogue loads', () => {
    expect(voicesFor('elevenlabs', [], 'eleven_multilingual_v2')).toEqual([])
  })

  // OpenRouter voices are per model, so borrowing another model's list would
  // hand the speech endpoint a name it rejects.
  it('infers OpenRouter voices from the model id rather than from its neighbours', () => {
    const models = [model('elevenlabs-ish', ['Bella']), model('openai/gpt-4o-mini-tts')]

    expect(voicesFor('openrouter', models, 'openai/gpt-4o-mini-tts')).toEqual(
      OPENAI_VOICES.map((name) => ({ id: name, name })),
    )
    expect(voicesFor('openrouter', models, 'google/gemini-3.1-flash-tts-preview')[0]).toEqual({
      id: 'Aoede',
      name: 'Aoede',
    })
    expect(voicesFor('openrouter', models, 'hexgrad/kokoro-82m')).toEqual([])
  })
})
