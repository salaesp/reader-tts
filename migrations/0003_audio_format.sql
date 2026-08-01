-- Remembers which response_format the selected OpenRouter model accepts.
--
-- mp3 is roughly a tenth the size of pcm, but the Gemini TTS line only emits
-- pcm and rejects mp3 with a bare "Provider returned 400". The synthesis path
-- discovers which one works by trying mp3 first; without somewhere to write
-- that down, every chunk pays the rejected attempt again — and with two chunks
-- prefetched ahead, that is three wasted round trips at a time.
--
-- Reset to 'mp3' whenever the model changes, so moving to a model that does
-- support mp3 does not keep paying for uncompressed audio forever.

ALTER TABLE settings ADD COLUMN openrouter_audio_format TEXT NOT NULL DEFAULT 'mp3';
