import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book } from '../../shared/types'
import { useI18n } from '../i18n'
import { ApiError, api } from '../lib/api'
import { EpubError, openEpub } from '../lib/epub'
import { useRouter } from '../lib/router'
import { store } from '../lib/store'
import { BookCard } from '../components/BookCard'
import { Banner, Button, Spinner } from '../components/ui'

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024

type UploadState = { phase: 'idle' } | { phase: 'parsing' | 'uploading'; name: string }

export default function Library() {
  const { t } = useI18n()
  const { navigate } = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' })
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { books: fetched } = await api.listBooks()
      setBooks(fetched)
      setOffline(false)
      void store.saveBooks(fetched)
    } catch (err) {
      // Falling back to the local copy keeps the library readable on a plane.
      const cached = await store.listBooks()
      if (cached.length > 0) {
        setBooks(cached.sort((a, b) => b.addedAt - a.addedAt))
        setOffline(true)
      } else if (err instanceof ApiError && !err.isUnauthorized) {
        setError(t('library.uploadError'))
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleFile = async (file: File): Promise<void> => {
    setError(null)

    if (!/\.epub$/i.test(file.name) && file.type !== 'application/epub+zip') {
      setError(t('library.invalidFile'))
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('library.tooLarge', { max: '60 MB' }))
      return
    }

    setUpload({ phase: 'parsing', name: file.name })
    try {
      // Parsing here means the server never has to open the zip, and an invalid
      // file is rejected before anything is uploaded.
      const epub = await openEpub(file)
      const form = new FormData()
      form.set('file', file, file.name)
      form.set('title', epub.metadata.title)
      if (epub.metadata.author) form.set('author', epub.metadata.author)
      if (epub.metadata.language) form.set('language', epub.metadata.language)
      if (epub.cover) {
        form.set('cover', new File([epub.cover.blob], 'cover', { type: epub.cover.type }))
      }
      epub.dispose()

      setUpload({ phase: 'uploading', name: file.name })
      const { book } = await api.uploadBook(form)

      // Keep the bytes we already have so the first open works offline.
      void store.saveFile(book.id, file)
      setBooks((current) => [book, ...current])
      void store.saveBooks([book, ...books])
    } catch (err) {
      console.error('upload failed', err)
      if (err instanceof EpubError) setError(t('library.invalidFile'))
      else if (err instanceof ApiError && err.code === 'file_too_large') {
        setError(t('library.tooLarge', { max: '60 MB' }))
      } else setError(t('library.uploadError'))
    } finally {
      setUpload({ phase: 'idle' })
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const handleDelete = async (book: Book): Promise<void> => {
    if (!window.confirm(t('library.deleteConfirm', { title: book.title }))) return
    setBooks((current) => current.filter((entry) => entry.id !== book.id))
    void store.removeBook(book.id)
    try {
      await api.deleteBook(book.id)
    } catch (err) {
      console.error('delete failed', err)
      void refresh()
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-50">{t('library.title')}</h1>

        <Button
          variant="primary"
          onClick={() => fileInput.current?.click()}
          disabled={upload.phase !== 'idle'}
        >
          {upload.phase === 'idle' ? (
            <>
              <PlusIcon /> {t('library.upload')}
            </>
          ) : (
            <>
              <Spinner />
              {upload.phase === 'parsing' ? t('library.parsing') : t('library.uploading', { name: '' })}
            </>
          )}
        </Button>

        <input
          ref={fileInput}
          type="file"
          accept=".epub,application/epub+zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 empty:hidden">
        {offline && <Banner tone="warn">{t('library.offline')}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-16 text-sm text-slate-400">
          <Spinner /> {t('common.loading')}
        </p>
      ) : books.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 px-6 py-16 text-center">
          <p className="text-slate-300">{t('library.empty')}</p>
          <p className="mt-1 text-sm text-slate-500">{t('library.emptyHint')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => navigate({ name: 'reader', bookId: book.id })}
              onDelete={() => void handleDelete(book)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}
