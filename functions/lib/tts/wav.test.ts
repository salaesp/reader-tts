import { describe, expect, it } from 'vitest'
import { DEFAULT_PCM_FORMAT, parsePcmFormat, pcmToWav } from './wav'

function ascii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('')
}

describe('pcmToWav', () => {
  const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer

  it('writes a RIFF/WAVE header the size of the samples plus 44 bytes', () => {
    const wav = pcmToWav(pcm)
    const view = new DataView(wav)

    expect(wav.byteLength).toBe(44 + pcm.byteLength)
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(ascii(view, 36, 4)).toBe('data')
    // Everything after the size field itself.
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength)
    expect(view.getUint32(40, true)).toBe(pcm.byteLength)
  })

  it('describes the samples as uncompressed PCM at the given rate', () => {
    const view = new DataView(pcmToWav(pcm, { sampleRate: 48000, channels: 2, bitsPerSample: 16 }))

    expect(view.getUint16(20, true)).toBe(1) // 1 = uncompressed
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(48000) // sample rate
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2) // byte rate
    expect(view.getUint16(32, true)).toBe(4) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
  })

  it('copies the samples in unchanged', () => {
    const wav = pcmToWav(pcm)

    expect(new Uint8Array(wav, 44)).toEqual(new Uint8Array(pcm))
  })

  it('produces a header-only file for empty input rather than throwing', () => {
    expect(pcmToWav(new ArrayBuffer(0)).byteLength).toBe(44)
  })
})

describe('parsePcmFormat', () => {
  it('reads the rate and channels out of the content type', () => {
    expect(parsePcmFormat('audio/pcm; rate=16000; channels=2')).toEqual({
      sampleRate: 16000,
      channels: 2,
      bitsPerSample: 16,
    })
  })

  it('accepts the spellings providers actually use', () => {
    expect(parsePcmFormat('audio/pcm; sample_rate=8000').sampleRate).toBe(8000)
    expect(parsePcmFormat('audio/L16; rate="44100"').sampleRate).toBe(44100)
  })

  // A wrong sample rate plays at the wrong pitch; a rejected response plays
  // nothing. Guessing is the better failure.
  it('falls back to the Gemini shape when nothing is declared', () => {
    expect(parsePcmFormat('audio/pcm')).toEqual(DEFAULT_PCM_FORMAT)
    expect(parsePcmFormat(null)).toEqual(DEFAULT_PCM_FORMAT)
  })

  it('does not read a rate out of the mime type digits', () => {
    // "audio/L16" must not be mistaken for bits=16 through a loose match.
    expect(parsePcmFormat('audio/L16').bitsPerSample).toBe(16)
    expect(parsePcmFormat('audio/L24; bits=24').bitsPerSample).toBe(24)
  })
})
