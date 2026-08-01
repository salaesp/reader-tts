import type {
  Book,
  Progress,
  Settings,
  SettingsUpdate,
  TtsModel,
  TtsProvider,
  TtsVoice,
  User,
  VoiceSource,
} from '../../shared/types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'ApiError'
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** No key is stored yet for the selected TTS provider. */
  get needsApiKey(): boolean {
    return this.status === 412 || this.code === 'no_api_key'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init })
  } catch (err) {
    throw new ApiError(0, 'network_error', err instanceof Error ? err.message : undefined)
  }

  if (!response.ok) {
    let code = `http_${response.status}`
    let detail: string | undefined
    try {
      const body = (await response.json()) as { error?: string; detail?: string }
      if (body.error) code = body.error
      detail = body.detail
    } catch {
      // Non-JSON error bodies carry no extra information.
    }
    throw new ApiError(response.status, code, detail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  getConfig: () => request<{ googleClientId: string }>('/api/config'),

  getSession: () => request<{ user: User }>('/api/auth/session'),

  login: (idToken: string) =>
    request<{ user: User }>('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }),

  logout: () => request<{ ok: true }>('/api/auth/session', { method: 'DELETE' }),

  getSettings: () => request<{ settings: Settings }>('/api/settings'),

  updateSettings: (update: SettingsUpdate) =>
    request<{ settings: Settings }>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    }),

  listBooks: () => request<{ books: Book[] }>('/api/books'),

  getBook: (id: string) => request<{ book: Book }>(`/api/books/${encodeURIComponent(id)}`),

  uploadBook: (form: FormData) =>
    request<{ book: Book }>('/api/books', { method: 'POST', body: form }),

  deleteBook: (id: string) =>
    request<{ ok: true }>(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  putProgress: (bookId: string, progress: Progress) =>
    request<{ progress: Progress | null }>(
      `/api/books/${encodeURIComponent(bookId)}/progress`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(progress),
      },
    ),

  /** Voices for one model; costs an upstream request, so it is asked for lazily. */
  listTtsVoices: (provider: TtsProvider, model: string) =>
    request<{ model: string; provider: TtsProvider; voices: TtsVoice[]; source: VoiceSource }>(
      `/api/tts/voices?provider=${provider}&model=${encodeURIComponent(model)}`,
    ),

  listTtsModels: (provider?: TtsProvider) =>
    request<{ provider: TtsProvider; models: TtsModel[] }>(
      provider ? `/api/tts/models?provider=${provider}` : '/api/tts/models',
    ),

  /** Downloads the stored EPUB. Returns the raw bytes for the parser. */
  async downloadBook(id: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(`/api/books/${encodeURIComponent(id)}/file`, {
      credentials: 'same-origin',
      signal,
    })
    if (!response.ok) throw new ApiError(response.status, 'download_failed')
    return response.blob()
  },

  /** Synthesizes one chunk. Resolves to the audio bytes. */
  async synthesize(
    body: {
      text: string
      hash: string
      provider: TtsProvider
      model: string
      voice: string
      bookId?: string
    },
    signal?: AbortSignal,
  ): Promise<Blob> {
    let response: Response
    try {
      response = await fetch('/api/tts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ApiError(0, 'network_error', err instanceof Error ? err.message : undefined)
    }

    if (!response.ok) {
      // Only failures are JSON here; a 200 is raw audio.
      let code = `http_${response.status}`
      let detail: string | undefined
      try {
        const error = (await response.json()) as { error?: string; detail?: string }
        if (error.error) code = error.error
        detail = error.detail
      } catch {
        // ignore
      }
      throw new ApiError(response.status, code, detail)
    }

    return response.blob()
  },
}
