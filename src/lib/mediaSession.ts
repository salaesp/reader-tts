/**
 * Lock-screen and notification controls. Without this, listening with the
 * screen off means unlocking the phone to pause, which is the common case for
 * an audiobook app.
 */

export interface MediaSessionHandlers {
  play: () => void
  pause: () => void
  nextTrack: () => void
  previousTrack: () => void
}

export interface MediaMetadataInput {
  title: string
  artist: string
  album: string
  artworkUrl: string | null
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

export function setMediaMetadata(input: MediaMetadataInput): void {
  if (!supported() || typeof MediaMetadata === 'undefined') return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: input.title,
    artist: input.artist,
    album: input.album,
    artwork: input.artworkUrl
      ? [{ src: input.artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
      : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  })
}

export function setMediaHandlers(handlers: MediaSessionHandlers): () => void {
  if (!supported()) return () => {}

  const entries: [MediaSessionAction, () => void][] = [
    ['play', handlers.play],
    ['pause', handlers.pause],
    ['nexttrack', handlers.nextTrack],
    ['previoustrack', handlers.previousTrack],
    // Phones map the skip buttons differently; wire both so either works.
    ['seekforward', handlers.nextTrack],
    ['seekbackward', handlers.previousTrack],
  ]

  for (const [action, handler] of entries) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Not every browser implements every action.
    }
  }

  return () => {
    for (const [action] of entries) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      } catch {
        // ignore
      }
    }
  }
}

export function setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
  if (!supported()) return
  navigator.mediaSession.playbackState = state
}
