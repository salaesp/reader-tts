import { useEffect, useRef, useState } from 'react'
import type { ReadingLang, TtsModel, UiLang } from '../../shared/types'
import { CHIRP3_VOICES } from '../../shared/types'
import { useI18n } from '../i18n'
import { ApiError, api } from '../lib/api'
import { chunkHash } from '../lib/segmenter'
import { useSession } from '../lib/session'
import { store } from '../lib/store'
import { browserVoiceAvailable, loadBrowserVoices, pickBrowserVoice } from '../lib/tts'
import { Banner, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui'

const CUSTOM_MODEL = '__custom__'

export default function Settings() {
  const { t, lang } = useI18n()
  const { user, settings, signOut, updateSettings } = useSession()

  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [models, setModels] = useState<TtsModel[]>([])
  const [modelsError, setModelsError] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [usage, setUsage] = useState<number | null>(null)
  const testAudio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const { models: fetched } = await api.listTtsModels()
        setModels(fetched)
        setCustomModel(fetched.length > 0 && !fetched.some((m) => m.id === settings.ttsModel))
      } catch {
        setModelsError(true)
        setCustomModel(true)
      }
    })()
    void store.estimateUsage().then(setUsage)
    // Only the initial model list matters; later edits should not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => testAudio.current?.pause(), [])

  const save = async (update: Parameters<typeof updateSettings>[0]): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      await updateSettings(update)
      setStatus({ tone: 'success', message: t('settings.saved') })
    } catch (err) {
      console.error('settings save failed', err)
      setStatus({ tone: 'error', message: t('settings.saveError') })
    } finally {
      setSaving(false)
    }
  }

  const testVoice = async (): Promise<void> => {
    setTesting(true)
    setStatus(null)
    const text = t('settings.testText')

    try {
      if (settings.useBrowserVoice) {
        const voices = await loadBrowserVoices()
        const utterance = new SpeechSynthesisUtterance(text)
        const voice = pickBrowserVoice(voices, settings.readingLang)
        if (voice) utterance.voice = voice
        utterance.rate = settings.speed
        speechSynthesis.cancel()
        speechSynthesis.speak(utterance)
      } else {
        const hash = await chunkHash(settings.ttsModel, settings.ttsVoice, text)
        const blob = await api.synthesize({
          text,
          hash,
          model: settings.ttsModel,
          voice: settings.ttsVoice,
        })
        testAudio.current?.pause()
        const audio = new Audio(URL.createObjectURL(blob))
        audio.playbackRate = settings.speed
        testAudio.current = audio
        await audio.play()
      }
      setStatus({ tone: 'success', message: t('settings.testOk') })
    } catch (err) {
      const detail =
        err instanceof ApiError ? (err.detail ?? err.code) : err instanceof Error ? err.message : '?'
      setStatus({ tone: 'error', message: t('settings.testError', { detail }) })
    } finally {
      setTesting(false)
    }
  }

  const selectedModel = models.find((model) => model.id === settings.ttsModel)
  const voiceOptions =
    selectedModel?.voices.length
      ? selectedModel.voices
      : settings.ttsModel.startsWith('google/')
        ? CHIRP3_VOICES
        : []

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">
      <h1 className="mb-5 text-xl font-semibold text-slate-50">{t('settings.title')}</h1>

      {status && (
        <div className="mb-4">
          <Banner tone={status.tone}>{status.message}</Banner>
        </div>
      )}

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t('settings.account')}
        </h2>
        <div className="flex items-center gap-3">
          {user?.picture ? (
            <img src={user.picture} alt="" className="size-11 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex size-11 items-center justify-center rounded-full bg-slate-800 text-slate-400">
              {user?.name.charAt(0).toUpperCase() ?? '?'}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-100">{user?.name}</p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
          </div>
          <Button onClick={() => void signOut()}>{t('nav.signOut')}</Button>
        </div>
      </Card>

      <Card className="mb-4 flex flex-col gap-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t('settings.voice')}
        </h2>

        <Field label={t('settings.apiKey')} hint={t('settings.apiKeyHelp')}>
          <div className="flex gap-2">
            <TextInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKeyDraft}
              placeholder={
                settings.hasApiKey && settings.apiKeyHint
                  ? t('settings.apiKeySaved', { hint: settings.apiKeyHint })
                  : t('settings.apiKeyPlaceholder')
              }
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
            <Button
              variant="primary"
              disabled={!apiKeyDraft.trim() || saving}
              onClick={() => {
                void save({ apiKey: apiKeyDraft.trim() }).then(() => setApiKeyDraft(''))
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </Field>

        <div className="-mt-2 flex flex-wrap gap-3 text-xs">
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-400 hover:underline"
          >
            {t('settings.apiKeyGet')}
          </a>
          {settings.hasApiKey && (
            <button
              type="button"
              onClick={() => void save({ apiKey: null })}
              className="text-slate-400 hover:text-red-400"
            >
              {t('settings.removeKey')}
            </button>
          )}
        </div>

        <Field label={t('settings.model')} hint={t('settings.modelHelp')}>
          <Select
            value={customModel ? CUSTOM_MODEL : settings.ttsModel}
            onChange={(event) => {
              if (event.target.value === CUSTOM_MODEL) {
                setCustomModel(true)
                return
              }
              setCustomModel(false)
              void save({ ttsModel: event.target.value })
            }}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>{t('settings.modelCustom')}</option>
          </Select>
        </Field>

        {modelsError && <Banner tone="warn">{t('settings.modelsError')}</Banner>}

        {customModel && (
          <div className="flex gap-2">
            <TextInput
              defaultValue={settings.ttsModel}
              spellCheck={false}
              placeholder="google/chirp-3"
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== settings.ttsModel) void save({ ttsModel: value })
              }}
            />
          </div>
        )}

        <Field label={t('settings.voiceLabel')}>
          {voiceOptions.length > 0 ? (
            <Select
              value={settings.ttsVoice}
              onChange={(event) => void save({ ttsVoice: event.target.value })}
            >
              {voiceOptions.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
              {!voiceOptions.includes(settings.ttsVoice) && (
                <option value={settings.ttsVoice}>{settings.ttsVoice}</option>
              )}
            </Select>
          ) : (
            <TextInput
              defaultValue={settings.ttsVoice}
              spellCheck={false}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== settings.ttsVoice) void save({ ttsVoice: value })
              }}
            />
          )}
        </Field>

        <div>
          <Button onClick={() => void testVoice()} disabled={testing}>
            {testing ? (
              <>
                <Spinner /> {t('settings.testing')}
              </>
            ) : (
              t('settings.testVoice')
            )}
          </Button>
        </div>

        <Field label={`${t('settings.speed')}: ${settings.speed}×`}>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={settings.speed}
            onChange={(event) => void save({ speed: Number(event.target.value) })}
            className="w-full accent-sky-500"
          />
        </Field>

        {browserVoiceAvailable() && (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={settings.useBrowserVoice}
              onChange={(event) => void save({ useBrowserVoice: event.target.checked })}
              className="mt-0.5 size-4 accent-sky-500"
            />
            <span>
              <span className="block text-sm text-slate-200">{t('settings.browserVoice')}</span>
              <span className="block text-xs text-slate-400">{t('settings.browserVoiceHelp')}</span>
            </span>
          </label>
        )}
      </Card>

      <Card className="mb-4 flex flex-col gap-4 p-4">
        <Field label={t('settings.uiLang')}>
          <Select
            value={lang}
            onChange={(event) => void save({ uiLang: event.target.value as UiLang })}
          >
            <option value="es">{t('lang.es')}</option>
            <option value="en">{t('lang.en')}</option>
          </Select>
        </Field>

        <Field label={t('settings.readingLang')} hint={t('settings.readingLangHelp')}>
          <Select
            value={settings.readingLang}
            onChange={(event) => void save({ readingLang: event.target.value as ReadingLang })}
          >
            <option value="es">{t('lang.es')}</option>
            <option value="en">{t('lang.en')}</option>
          </Select>
        </Field>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t('settings.storage')}
        </h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-300">
            {usage !== null ? formatBytes(usage) : '—'}
          </p>
          <Button
            onClick={() => {
              void store.clearAllAudio().then(async () => {
                setUsage(await store.estimateUsage())
                setStatus({ tone: 'success', message: t('settings.cacheCleared') })
              })
            }}
          >
            {t('settings.clearCache')}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
