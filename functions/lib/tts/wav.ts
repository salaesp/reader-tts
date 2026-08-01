/**
 * Wraps raw PCM samples in a WAV container.
 *
 * Several TTS models only emit uncompressed PCM — Gemini's among them, which
 * answers a request for mp3 with a provider 400. PCM has no container, so an
 * <audio> element cannot play the bytes as they arrive: a 44-byte RIFF header
 * in front of them is the whole difference, and it costs one copy.
 */

export interface PcmFormat {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

/** What Gemini TTS emits, and a safe reading of an unlabelled PCM stream. */
export const DEFAULT_PCM_FORMAT: PcmFormat = {
  sampleRate: 24000,
  channels: 1,
  bitsPerSample: 16,
}

const HEADER_BYTES = 44

export function pcmToWav(pcm: ArrayBuffer, format: PcmFormat = DEFAULT_PCM_FORMAT): ArrayBuffer {
  const { sampleRate, channels, bitsPerSample } = format
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = channels * bytesPerSample

  const out = new ArrayBuffer(HEADER_BYTES + pcm.byteLength)
  const view = new DataView(out)

  writeAscii(view, 0, 'RIFF')
  // Everything after this field, i.e. the header minus "RIFF" and the size itself.
  view.setUint32(4, HEADER_BYTES - 8 + pcm.byteLength, true)
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk length
  view.setUint16(20, 1, true) // format 1 = uncompressed PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  writeAscii(view, 36, 'data')
  view.setUint32(40, pcm.byteLength, true)

  new Uint8Array(out, HEADER_BYTES).set(new Uint8Array(pcm))
  return out
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/**
 * Reads the PCM shape out of a content-type such as
 * `audio/pcm; rate=24000; channels=1`. Providers spell these differently and
 * some omit them, so anything missing falls back to the default rather than
 * failing: a wrong sample rate plays at the wrong pitch, a rejected response
 * plays nothing.
 */
export function parsePcmFormat(contentType: string | null): PcmFormat {
  if (!contentType) return DEFAULT_PCM_FORMAT

  const number = (...names: string[]): number | null => {
    for (const name of names) {
      const match = new RegExp(`[;\\s]${name}\\s*=\\s*"?(\\d+)`, 'i').exec(contentType)
      if (match) return Number(match[1])
    }
    return null
  }

  return {
    sampleRate: number('rate', 'sample_rate', 'samplerate') ?? DEFAULT_PCM_FORMAT.sampleRate,
    channels: number('channels', 'channel_count') ?? DEFAULT_PCM_FORMAT.channels,
    bitsPerSample: number('bits', 'bits_per_sample') ?? DEFAULT_PCM_FORMAT.bitsPerSample,
  }
}
