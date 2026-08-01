-- Adds the ElevenLabs provider to an existing database.
--
-- `schema.sql` uses CREATE TABLE IF NOT EXISTS, so a database created before
-- this change never picks up the new columns. Run this once against it:
--
--   npm run db:migrate:local
--   npm run db:migrate:remote
--
-- A fresh database gets these columns straight from schema.sql and does not
-- need this file. SQLite has no ADD COLUMN IF NOT EXISTS, so running it twice
-- fails with "duplicate column name" — that error means it already applied.

ALTER TABLE settings ADD COLUMN tts_provider TEXT NOT NULL DEFAULT 'openrouter';
ALTER TABLE settings ADD COLUMN elevenlabs_key_enc TEXT;
ALTER TABLE settings ADD COLUMN elevenlabs_key_hint TEXT;
ALTER TABLE settings ADD COLUMN elevenlabs_model TEXT NOT NULL DEFAULT 'eleven_multilingual_v2';
ALTER TABLE settings ADD COLUMN elevenlabs_voice TEXT NOT NULL DEFAULT '';
