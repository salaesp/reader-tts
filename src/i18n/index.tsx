import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { UiLang } from '../../shared/types'
import es from './es.json'
import en from './en.json'

const dictionaries: Record<UiLang, Record<string, string>> = { es, en }

export type TranslateKey = keyof typeof es

export type Translate = (key: TranslateKey, vars?: Record<string, string | number>) => string

interface I18nValue {
  lang: UiLang
  t: Translate
  setLang: (lang: UiLang) => void
}

const I18nContext = createContext<I18nValue | null>(null)

/** Best-effort guess from the browser, used until settings load. */
export function detectLang(): UiLang {
  const stored = localStorage.getItem('uiLang')
  if (stored === 'es' || stored === 'en') return stored
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function I18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: UiLang
  setLang: (lang: UiLang) => void
  children: ReactNode
}) {
  const t = useCallback<Translate>(
    (key, vars) => {
      const template = dictionaries[lang][key] ?? dictionaries.en[key] ?? key
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      )
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
