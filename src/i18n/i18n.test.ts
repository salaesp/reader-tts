import { describe, expect, it } from 'vitest'
import en from './en.json'
import es from './es.json'

/**
 * `TranslateKey` is `keyof typeof es`, so a key missing from es.json is a
 * compile error — but one missing from en.json is not. The lookup in
 * `src/i18n/index.tsx` falls back `es[key] ?? en[key] ?? key`, so the gap
 * surfaces to an English reader as the raw key string, which nothing else
 * catches. This is the check the type system cannot make.
 */
describe('translations', () => {
  const esKeys = Object.keys(es).sort()
  const enKeys = Object.keys(en).sort()

  it('define the same keys in both languages', () => {
    expect(enKeys.filter((key) => !(key in es))).toEqual([])
    expect(esKeys.filter((key) => !(key in en))).toEqual([])
  })

  it('use the same placeholders in both languages', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

    const mismatched = esKeys.filter((key) => {
      const spanish = (es as Record<string, string>)[key]
      const english = (en as Record<string, string>)[key]
      if (typeof english !== 'string') return false
      return placeholders(spanish).join() !== placeholders(english).join()
    })

    expect(mismatched).toEqual([])
  })

  it('leave no value empty', () => {
    expect(esKeys.filter((key) => !(es as Record<string, string>)[key].trim())).toEqual([])
    expect(enKeys.filter((key) => !(en as Record<string, string>)[key].trim())).toEqual([])
  })
})
