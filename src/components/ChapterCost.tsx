import type { ReadingLang, TtsPricing } from '../../shared/types'
import { estimateUsd, formatUsd } from '../../shared/types'
import { useI18n } from '../i18n'
import type { ChapterWork } from '../lib/estimate'

/**
 * What the rest of this chapter will cost.
 *
 * Shown before playing rather than after, because the app spends the reader's
 * own API key. Everything here is hedged: the character-to-token ratio is a
 * guess, so the figure carries a `≈` and an explanation, and a model that also
 * bills output is reported as a floor — audio duration does not follow from
 * text length. When the price is unknown nothing is claimed at all.
 */
export function ChapterCost({
  work,
  pricing,
  lang,
  browserVoice,
}: {
  work: ChapterWork | null
  /** Fetched once by the Reader and shared with the download button. */
  pricing: TtsPricing | null
  lang: ReadingLang
  browserVoice: boolean
}) {
  const { t } = useI18n()

  // The browser voice is free, and the reader banner already says so.
  if (browserVoice || !work || work.totalChunks === 0) return null

  if (work.pendingChunks === 0) {
    return <Line>{t('reader.costNothingLeft')}</Line>
  }

  const estimate = estimateUsd(work.pendingChars, lang, pricing)
  const cached =
    work.pendingChunks < work.totalChunks
      ? ` · ${t('reader.costCached', {
          done: work.totalChunks - work.pendingChunks,
          total: work.totalChunks,
        })}`
      : ''

  // No published price — ElevenLabs bills a character quota, and some models
  // publish nothing at all. Report the size of the job, never a dollar figure.
  if (!estimate) {
    return (
      <Line title={t('reader.costCharsHelp')}>
        {t('reader.costChars', { chars: formatChars(work.pendingChars) })}
        {cached}
      </Line>
    )
  }

  const amount = formatUsd(estimate.usd)
  return (
    <Line title={t('reader.costApproxHelp')}>
      {estimate.isFloor
        ? t('reader.costFrom', { amount })
        : t('reader.costApprox', { amount })}
      {cached}
    </Line>
  )
}

function Line({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="text-xs text-slate-500" title={title}>
      {children}
    </span>
  )
}

function formatChars(chars: number): string {
  return chars.toLocaleString()
}
