import type { Book, Progress } from '../../shared/types'

/**
 * IndexedDB cache. Keeps the app usable offline and avoids re-downloading (and
 * re-paying for) content that has already been fetched:
 *
 *  - `books`    book metadata, so the library renders without a network call
 *  - `files`    the EPUB bytes, so a downloaded book opens offline
 *  - `audio`    rendered TTS chunks, keyed by the same hash the server uses
 *  - `progress` the latest local reading position, synced opportunistically
 */

const DB_NAME = 'reader-tts'
const DB_VERSION = 1

const STORE_BOOKS = 'books'
const STORE_FILES = 'files'
const STORE_AUDIO = 'audio'
const STORE_PROGRESS = 'progress'

interface AudioEntry {
  hash: string
  bookId: string
  blob: Blob
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES)
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        const store = db.createObjectStore(STORE_AUDIO, { keyPath: 'hash' })
        store.createIndex('bookId', 'bookId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        db.createObjectStore(STORE_PROGRESS)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
  })

  return dbPromise
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const request = action(tx.objectStore(storeName))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'))
      }),
  )
}

/**
 * Every accessor swallows storage failures: a browser in private mode, or one
 * that has evicted the database, should degrade to online-only rather than
 * break the app.
 */
async function safe<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    console.warn('local store unavailable', err)
    return fallback
  }
}

export const store = {
  async saveBooks(books: Book[]): Promise<void> {
    await safe(async () => {
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_BOOKS, 'readwrite')
        const objectStore = tx.objectStore(STORE_BOOKS)
        objectStore.clear()
        for (const book of books) objectStore.put(book)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('save failed'))
      })
    }, undefined)
  },

  /**
   * Caches one book without disturbing the rest. `saveBooks` clears the store
   * first, which is right for a library listing and wrong for a single book.
   */
  async saveBook(book: Book): Promise<void> {
    await safe(() => run(STORE_BOOKS, 'readwrite', (s) => s.put(book)), undefined)
  },

  listBooks: () => safe(() => run<Book[]>(STORE_BOOKS, 'readonly', (s) => s.getAll()), []),

  getBook: (id: string) =>
    safe(() => run<Book | undefined>(STORE_BOOKS, 'readonly', (s) => s.get(id)), undefined),

  async removeBook(id: string): Promise<void> {
    await safe(async () => {
      await run(STORE_BOOKS, 'readwrite', (s) => s.delete(id))
      await run(STORE_FILES, 'readwrite', (s) => s.delete(id))
      await run(STORE_PROGRESS, 'readwrite', (s) => s.delete(id))
      await store.clearAudioForBook(id)
    }, undefined)
  },

  getFile: (bookId: string) =>
    safe(() => run<Blob | undefined>(STORE_FILES, 'readonly', (s) => s.get(bookId)), undefined),

  async saveFile(bookId: string, blob: Blob): Promise<void> {
    await safe(() => run(STORE_FILES, 'readwrite', (s) => s.put(blob, bookId)), undefined)
  },

  async getAudio(hash: string): Promise<Blob | undefined> {
    const entry = await safe(
      () => run<AudioEntry | undefined>(STORE_AUDIO, 'readonly', (s) => s.get(hash)),
      undefined,
    )
    return entry?.blob
  },

  /**
   * Returns whether the audio actually landed. A full quota rejects the write,
   * and callers that report "saved for offline" need to know that happened —
   * `safe` would otherwise turn a dropped write into a silent success.
   */
  async saveAudio(hash: string, bookId: string, blob: Blob): Promise<boolean> {
    const entry: AudioEntry = { hash, bookId, blob, createdAt: Date.now() }
    return safe(async () => {
      await run(STORE_AUDIO, 'readwrite', (s) => s.put(entry))
      return true
    }, false)
  },

  /**
   * Hashes of every cached chunk of a book, in one transaction.
   *
   * Asking `getAudio` per chunk would pull each blob into memory just to learn
   * that it exists — megabytes to answer a yes/no. The primary key of the audio
   * store is the hash, so the bookId index yields them directly.
   */
  async cachedHashes(bookId: string): Promise<Set<string>> {
    const keys = await safe(
      () =>
        openDb().then(
          (db) =>
            new Promise<IDBValidKey[]>((resolve, reject) => {
              const tx = db.transaction(STORE_AUDIO, 'readonly')
              const request = tx.objectStore(STORE_AUDIO).index('bookId').getAllKeys(bookId)
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error ?? new Error('index read failed'))
            }),
        ),
      [] as IDBValidKey[],
    )
    // An unreadable cache reads as "nothing cached", which over-estimates cost
    // and re-downloads — the safe direction for both callers.
    return new Set(keys.filter((key): key is string => typeof key === 'string'))
  },

  async clearAudioForBook(bookId: string): Promise<void> {
    await safe(async () => {
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_AUDIO, 'readwrite')
        const index = tx.objectStore(STORE_AUDIO).index('bookId')
        const cursorRequest = index.openCursor(IDBKeyRange.only(bookId))
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          cursor.delete()
          cursor.continue()
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
      })
    }, undefined)
  },

  async clearAllAudio(): Promise<void> {
    await safe(() => run(STORE_AUDIO, 'readwrite', (s) => s.clear()), undefined)
  },

  getProgress: (bookId: string) =>
    safe(
      () => run<Progress | undefined>(STORE_PROGRESS, 'readonly', (s) => s.get(bookId)),
      undefined,
    ),

  async saveProgress(bookId: string, progress: Progress): Promise<void> {
    await safe(() => run(STORE_PROGRESS, 'readwrite', (s) => s.put(progress, bookId)), undefined)
  },

  /** Approximate bytes held by the cache, for the Settings screen. */
  async estimateUsage(): Promise<number | null> {
    if (!navigator.storage?.estimate) return null
    try {
      const { usage } = await navigator.storage.estimate()
      return usage ?? null
    } catch {
      return null
    }
  },
}
