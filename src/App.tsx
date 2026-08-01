import { useCallback, useEffect, useState } from 'react'
import type { UiLang } from '../shared/types'
import { I18nProvider, detectLang, useI18n } from './i18n'
import { SessionProvider, useSession } from './lib/session'
import { useRouter } from './lib/router'
import Library from './pages/Library'
import Login from './pages/Login'
import Reader from './pages/Reader'
import Settings from './pages/Settings'
import { Spinner } from './components/ui'

export default function App() {
  // The UI language is known before the session loads, so the login screen and
  // any bootstrap error are already localized.
  const [lang, setLang] = useState<UiLang>(detectLang)

  const changeLang = useCallback((next: UiLang) => {
    setLang(next)
    localStorage.setItem('uiLang', next)
    document.documentElement.lang = next
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return (
    <I18nProvider lang={lang} setLang={changeLang}>
      <SessionProvider>
        <Shell onLangChange={changeLang} />
      </SessionProvider>
    </I18nProvider>
  )
}

function Shell({ onLangChange }: { onLangChange: (lang: UiLang) => void }) {
  const { user, settings, loading } = useSession()
  const { route } = useRouter()
  const { t } = useI18n()

  // Once signed in, the stored preference wins over the browser's guess.
  useEffect(() => {
    if (user) onLangChange(settings.uiLang)
  }, [user, settings.uiLang, onLangChange])

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6 text-slate-500" />
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <div className="flex min-h-dvh flex-col" style={{ paddingTop: 'var(--safe-top)' }}>
      {route.name !== 'reader' && <TopBar />}

      <main className="flex-1">
        {route.name === 'library' && <Library />}
        {route.name === 'reader' && <Reader key={route.bookId} bookId={route.bookId} />}
        {route.name === 'settings' && <Settings />}
      </main>

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:rounded-lg focus:bg-sky-500 focus:px-3 focus:py-2 focus:text-slate-950"
      >
        {t('nav.library')}
      </a>
    </div>
  )
}

function TopBar() {
  const { t } = useI18n()
  const { route, navigate } = useRouter()

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => navigate({ name: 'library' })}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-slate-100 hover:bg-slate-800"
        >
          <img src="/icons/icon-192.png" alt="" className="size-7 rounded-md" />
          <span className="font-semibold">{t('app.name')}</span>
        </button>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() =>
            navigate(route.name === 'settings' ? { name: 'library' } : { name: 'settings' })
          }
          aria-label={route.name === 'settings' ? t('nav.library') : t('nav.settings')}
          className={`rounded-lg p-2 hover:bg-slate-800 ${
            route.name === 'settings' ? 'text-sky-400' : 'text-slate-300'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
