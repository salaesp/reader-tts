-- Initial schema.
--
-- Kept exactly as it was first deployed: a migration is a record of what ran,
-- so editing one after the fact desynchronises every database that already
-- applied it. Schema changes go in a new numbered file.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  picture     TEXT,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- AES-GCM ciphertext of the OpenRouter key; never leaves the Worker in clear.
  openrouter_key_enc TEXT,
  -- Last 4 characters of the key, so the UI can show which key is stored.
  openrouter_key_hint TEXT,
  tts_model         TEXT NOT NULL DEFAULT 'google/chirp-3',
  tts_voice         TEXT NOT NULL DEFAULT 'Kore',
  speed             REAL NOT NULL DEFAULT 1.0,
  ui_lang           TEXT NOT NULL DEFAULT 'es',
  reading_lang      TEXT NOT NULL DEFAULT 'es',
  use_browser_voice INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  author      TEXT,
  language    TEXT,
  r2_key      TEXT NOT NULL,
  cover_key   TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_user ON books(user_id, added_at DESC);

CREATE TABLE IF NOT EXISTS progress (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL DEFAULT 0,
  chunk_index   INTEGER NOT NULL DEFAULT 0,
  char_offset   INTEGER NOT NULL DEFAULT 0,
  percent       REAL NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id)
);
