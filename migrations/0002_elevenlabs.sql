-- Adds ElevenLabs alongside OpenRouter as a TTS provider.
--
-- Key, model and voice are per provider: the two id namespaces have nothing in
-- common, and switching back and forth to compare them must not clobber either
-- selection.

ALTER TABLE settings ADD COLUMN tts_provider TEXT NOT NULL DEFAULT 'openrouter';

-- Same treatment as the OpenRouter key: AES-GCM ciphertext plus a 4-char hint.
ALTER TABLE settings ADD COLUMN elevenlabs_key_enc TEXT;
ALTER TABLE settings ADD COLUMN elevenlabs_key_hint TEXT;

ALTER TABLE settings ADD COLUMN elevenlabs_model TEXT NOT NULL DEFAULT 'eleven_multilingual_v2';

-- Empty until Settings picks one: voice ids belong to the account.
ALTER TABLE settings ADD COLUMN elevenlabs_voice TEXT NOT NULL DEFAULT '';
