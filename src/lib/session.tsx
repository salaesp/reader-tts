import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Settings, SettingsUpdate, User } from '../../shared/types'
import { DEFAULT_SPEED, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } from '../../shared/types'
import { ApiError, api } from './api'
import { signOutOfGoogle } from './googleSignIn'

interface SessionValue {
  user: User | null
  settings: Settings
  loading: boolean
  signIn: (idToken: string) => Promise<void>
  signOut: () => Promise<void>
  updateSettings: (update: SettingsUpdate) => Promise<Settings>
}

const FALLBACK_SETTINGS: Settings = {
  hasApiKey: false,
  apiKeyHint: null,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: DEFAULT_TTS_VOICE,
  speed: DEFAULT_SPEED,
  uiLang: 'es',
  readingLang: 'es',
  useBrowserVoice: false,
}

const SessionContext = createContext<SessionValue | null>(null)

/**
 * The last known identity, kept so an offline launch lands in the library
 * instead of the login screen. This is presentation only — every request is
 * still authorized by the session cookie on the server.
 */
const CACHE_KEY = 'session-cache'

interface SessionCache {
  user: User
  settings: Settings
}

function readCache(): SessionCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as SessionCache) : null
  } catch {
    return null
  }
}

function writeCache(cache: SessionCache | null): void {
  try {
    if (cache) localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // Private mode: the app still works, it just re-authenticates each launch.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { user: current } = await api.getSession()
        if (cancelled) return
        setUser(current)

        const { settings: stored } = await api.getSettings()
        if (cancelled) return
        setSettings(stored)
        writeCache({ user: current, settings: stored })
      } catch (err) {
        if (err instanceof ApiError && err.isUnauthorized) {
          // Genuinely signed out: drop the cached identity.
          writeCache(null)
        } else {
          // Offline or the server is unreachable — carry on with what we know
          // so downloaded books stay readable.
          const cache = readCache()
          if (cache && !cancelled) {
            setUser(cache.user)
            setSettings(cache.settings)
          } else {
            console.warn('session bootstrap failed', err)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (idToken: string) => {
    const { user: next } = await api.login(idToken)
    setUser(next)
    const { settings: stored } = await api.getSettings()
    setSettings(stored)
    writeCache({ user: next, settings: stored })
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      signOutOfGoogle()
      writeCache(null)
      setUser(null)
      setSettings(FALLBACK_SETTINGS)
    }
  }, [])

  const updateSettings = useCallback(async (update: SettingsUpdate) => {
    const { settings: next } = await api.updateSettings(update)
    setSettings(next)
    setUser((current) => {
      if (current) writeCache({ user: current, settings: next })
      return current
    })
    return next
  }, [])

  const value = useMemo(
    () => ({ user, settings, loading, signIn, signOut, updateSettings }),
    [user, settings, loading, signIn, signOut, updateSettings],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
