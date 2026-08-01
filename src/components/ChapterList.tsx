import type { EpubChapter } from '../lib/epub'
import { useI18n } from '../i18n'

export function ChapterList({
  chapters,
  currentIndex,
  onSelect,
  onClose,
}: {
  chapters: EpubChapter[]
  currentIndex: number
  onSelect: (index: number) => void
  onClose: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="fixed inset-0 z-30 flex">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />

      <aside className="relative ml-auto flex h-full w-full max-w-sm flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <header
          className="flex items-center justify-between border-b border-slate-800 px-4 py-3"
          style={{ paddingTop: 'calc(0.75rem + var(--safe-top))' }}
        >
          <h2 className="font-medium text-slate-100">{t('reader.chapters')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <ol className="flex-1 overflow-y-auto py-2">
          {chapters.map((chapter) => (
            <li key={chapter.index}>
              <button
                type="button"
                onClick={() => onSelect(chapter.index)}
                className={`flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-800 ${
                  chapter.index === currentIndex
                    ? 'bg-slate-800/60 font-medium text-sky-400'
                    : 'text-slate-300'
                }`}
              >
                <span className="w-6 shrink-0 text-right text-xs text-slate-500">
                  {chapter.index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {chapter.title ?? t('reader.chapter', { n: chapter.index + 1 })}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}
