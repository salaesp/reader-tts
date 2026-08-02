import { useEffect, useState } from 'react'
import type { Book } from '../../shared/types'
import { useI18n } from '../i18n'
import { IconButton, ProgressBar } from './ui'

export function BookCard({
  book,
  onOpen,
  onDelete,
}: {
  book: Book
  onOpen: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const percent = Math.round(book.progress?.percent ?? 0)
  const started = percent > 0

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-stretch gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
      >
        <Cover book={book} />

        <span className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-100">{book.title}</span>
            <span className="mt-0.5 block truncate text-sm text-slate-400">
              {book.author ?? t('library.unknownAuthor')}
            </span>
          </span>

          <span className="mt-3 block">
            <span className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
              <span>{started ? t('library.progress', { percent }) : t('library.notStarted')}</span>
              <span className="font-medium text-sky-400">
                {started ? t('library.continue') : t('library.start')}
              </span>
            </span>
            <ProgressBar percent={percent} />
          </span>
        </span>
      </button>

      <IconButton
        label={t('library.delete')}
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        className="absolute right-2 top-2 size-8 bg-slate-950/70 text-slate-400 opacity-0 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </IconButton>
    </li>
  )
}

/**
 * Covers come from an authenticated endpoint, so they are fetched as blobs
 * rather than set directly as an <img src>.
 */
function Cover({ book }: { book: Book }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!book.hasCover) return
    let objectUrl: string | null = null
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/cover`, {
          credentials: 'same-origin',
        })
        if (!response.ok || cancelled) return
        objectUrl = URL.createObjectURL(await response.blob())
        setUrl(objectUrl)
      } catch {
        // A missing cover just falls back to the placeholder.
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [book.id, book.hasCover])

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="size-24 shrink-0 rounded-xl object-cover shadow-md sm:size-28"
      />
    )
  }

  return (
    <span className="flex size-24 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-2xl font-semibold text-slate-600 shadow-inner sm:size-28">
      {book.title.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" strokeLinecap="round" />
    </svg>
  )
}
