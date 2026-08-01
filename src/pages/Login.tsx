import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { loadGoogleIdentity } from '../lib/googleSignIn'
import { useSession } from '../lib/session'
import { Banner, Spinner } from '../components/ui'

export default function Login() {
  const { t, lang } = useI18n()
  const { signIn } = useSession()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'signing-in' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { googleClientId } = await api.getConfig()
        if (cancelled) return
        if (!googleClientId) {
          setError(t('login.notConfigured'))
          setStatus('error')
          return
        }

        const identity = await loadGoogleIdentity()
        if (cancelled || !buttonRef.current) return

        identity.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          cancel_on_tap_outside: true,
          callback: (response) => {
            setStatus('signing-in')
            setError(null)
            signIn(response.credential).catch((err: unknown) => {
              console.error('sign-in failed', err)
              setError(t('login.error'))
              setStatus('ready')
            })
          },
        })

        identity.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'filled_blue',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          locale: lang,
          width: 280,
        })
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        console.error('google identity failed to load', err)
        setError(t('login.error'))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signIn, t, lang])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-4 text-center">
        <img src="/icons/icon-192.png" alt="" className="size-20 rounded-2xl shadow-lg" />
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-slate-400">{t('app.tagline')}</p>
        </div>
      </header>

      <section className="flex w-full max-w-sm flex-col items-center gap-5">
        <div className="text-center">
          <h2 className="text-lg font-medium text-slate-100">{t('login.title')}</h2>
          <p className="mt-1 text-sm text-slate-400">{t('login.subtitle')}</p>
        </div>

        {status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner /> {t('common.loading')}
          </p>
        )}

        {status === 'signing-in' && (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <Spinner /> {t('login.loading')}
          </p>
        )}

        {/* Google renders its own button here; it must stay mounted. */}
        <div ref={buttonRef} className={status === 'ready' ? 'min-h-11' : 'hidden'} />

        {error && <Banner tone="error">{error}</Banner>}
      </section>
    </main>
  )
}
