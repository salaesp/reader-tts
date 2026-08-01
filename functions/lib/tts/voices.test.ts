import { describe, expect, it } from 'vitest'
import { findVoices } from './voices'

/**
 * The field carrying the voices is undocumented, so these cover the shapes it
 * plausibly takes rather than one confirmed response. What matters is that a
 * miss returns nothing — the caller then falls back to inference — and that a
 * hit never invents a voice.
 */
describe('findVoices', () => {
  it('reads a flat list of names', () => {
    expect(findVoices({ id: 'x', voices: ['alloy', 'nova'] })).toEqual([
      { id: 'alloy', name: 'alloy' },
      { id: 'nova', name: 'nova' },
    ])
  })

  it('reads objects, preferring a label for display', () => {
    const model = { voices: [{ id: 'af_bella', name: 'Bella (American female)' }] }

    expect(findVoices(model)).toEqual([{ id: 'af_bella', name: 'Bella (American female)' }])
  })

  it('accepts the other names an id goes by', () => {
    expect(findVoices({ voices: [{ voice_id: 'v1' }, { voice: 'v2' }, { slug: 'v3' }] })).toEqual([
      { id: 'v1', name: 'v1' },
      { id: 'v2', name: 'v2' },
      { id: 'v3', name: 'v3' },
    ])
  })

  it('finds them nested, wherever the schema puts them', () => {
    const model = { id: 'x', architecture: { audio: { supported_voices: ['Kore', 'Puck'] } } }

    expect(findVoices(model).map((v) => v.id)).toEqual(['Kore', 'Puck'])
  })

  it('reads an id-to-label map', () => {
    expect(findVoices({ voices: { en_paul_happy: 'Paul (happy)' } })).toEqual([
      { id: 'en_paul_happy', name: 'Paul (happy)' },
    ])
  })

  it('drops duplicates, keeping the first label', () => {
    const model = { voices: [{ id: 'a', name: 'First' }, { id: 'a', name: 'Second' }] }

    expect(findVoices(model)).toEqual([{ id: 'a', name: 'First' }])
  })

  // Returning nothing is what makes the caller fall back to inference, so a
  // miss must not be papered over with junk.
  it('returns nothing when there is nothing voice-shaped', () => {
    expect(findVoices({ id: 'x', pricing: { audio: '0.001' } })).toEqual([])
    expect(findVoices({ voices: [] })).toEqual([])
    expect(findVoices({ voices: [null, 42, {}] })).toEqual([])
    expect(findVoices(null)).toEqual([])
    expect(findVoices('voices')).toEqual([])
  })

  it('does not mistake a neighbouring key for the voice list', () => {
    // "voice_count" is not a collection of voices.
    expect(findVoices({ voice_count: 12 })).toEqual([])
    expect(findVoices({ invoices: ['a'] })).toEqual([])
  })

  it('survives a deeply nested object without recursing forever', () => {
    let deep: Record<string, unknown> = { voices: ['buried'] }
    for (let i = 0; i < 40; i++) deep = { nested: deep }

    expect(() => findVoices(deep)).not.toThrow()
  })

  it('handles a self-referencing object', () => {
    const model: Record<string, unknown> = { id: 'x' }
    model.self = model

    expect(() => findVoices(model)).not.toThrow()
  })
})
