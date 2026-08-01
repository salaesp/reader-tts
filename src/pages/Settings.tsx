import { useEffect, useRef, useState } from 'react'
import type { ReadingLang, TtsModel, TtsProvider, UiLang } from '../../shared/types'
import { PROVIDER_KEY_URLS, PROVIDER_LABELS, TTS_PROVIDERS } from '../../shared/types'
import { useI18n } from '../i18n'
import { ApiError, api } from '../lib/api'
import { chunkHash } from '../lib/segmenter'
import { useSession } from '../lib/session'
import { store } from '../lib/store'
import {
  browserVoiceAvailable,
  browserVoicesFor,
  loadBrowserVoices,
  pickBrowserVoice,
  voicesFor,
  writeVoicePreference,
} from '../lib/tts'
import { Banner, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui'

const CUSTOM_MODEL = '__custom__'

export default function Settings() {
  const { t, lang } = useI18n()
  const { user, settings, signOut, updateSettings } = useSession()

  const provider = settings.ttsProvider
  const active = settings.providers[provider]

  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [models, setModels] = useState<TtsModel[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [customModel, setCustomModel] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [usage, setUsage] = useState<number | null>(null)
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([])
  const [deviceVoice, setDeviceVoice] = useState<string | null>(null)
  const testAudio = useRef<HTMLAudioElement | null>(null)

  // The catalogue is per provider, and for ElevenLabs it also depends on the
  // stored key — so it is refetched whenever either changes.
  useEffect(() => {
    let cancelled = false
    setLoadingModels(true)
    setModelsError(null)

    void (async () => {
      try {
        const { models: fetched } = await api.listTtsModels(provider)
        if (cancelled) return
        setModels(fetched)
        setCustomModel(fetched.length > 0 && !fetched.some((m) => m.id === active.model))
      } catch (err) {
        if (cancelled) return
        setModels([])
        setModelsError(
          err instanceof ApiError && err.code === 'no_api_key'
            ? t('settings.modelsNeedKey')
            : t('settings.modelsError'),
        )
        setCustomModel(true)
      } finally {
        if (!cancelled) setLoadingModels(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // Only the provider and whether a key exists should trigger a refetch;
    // editing the model must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, active.hasApiKey])

  useEffect(() => {
    void store.estimateUsage().then(setUsage)
  }, [])

  // The device's own voices, which have nothing to do with the cloud providers:
  // they come from the operating system and differ on every machine.
  useEffect(() => {
    if (!browserVoiceAvailable()) return
    let cancelled = false

    void loadBrowserVoices().then((all) => {
      if (cancelled) return
      const forLang = browserVoicesFor(all, settings.readingLang)
      setDeviceVoices(forLang)
      // Show which one would actually speak, rather than an empty select that
      // suggests nothing is configured.
      setDeviceVoice(pickBrowserVoice(all, settings.readingLang)?.voiceURI ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [settings.readingLang])

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

  const voiceOptions = voicesFor(provider, models, active.model)

  // ElevenLabs voice ids are per account, so there is no sensible default to
  // ship: the first voice the account exposes becomes the selection.
  useEffect(() => {
    if (active.voice || voiceOptions.length === 0 || saving) return
    void save({ provider, ttsVoice: voiceOptions[0].id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.voice, voiceOptions.length])

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
        const hash = await chunkHash(provider, active.model, active.voice, text)
        const blob = await api.synthesize({
          text,
          hash,
          provider,
          model: active.model,
          voice: active.voice,
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

        <Field label={t('settings.provider')} hint={t('settings.providerHelp')}>
          <Select
            value={provider}
            onChange={(event) => void save({ ttsProvider: event.target.value as TtsProvider })}
          >
            {TTS_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
                {settings.providers[id].hasApiKey ? '' : ` — ${t('settings.providerNoKey')}`}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('settings.apiKey', { provider: PROVIDER_LABELS[provider] })}
          hint={t('settings.apiKeyHelp')}
        >
          <div className="flex gap-2">
            <TextInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKeyDraft}
              placeholder={
                active.hasApiKey && active.apiKeyHint
                  ? t('settings.apiKeySaved', { hint: active.apiKeyHint })
                  : t(`settings.apiKeyPlaceholder.${provider}`)
              }
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
            <Button
              variant="primary"
              disabled={!apiKeyDraft.trim() || saving}
              onClick={() => {
                void save({ provider, apiKey: apiKeyDraft.trim() }).then(() => setApiKeyDraft(''))
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </Field>

        <div className="-mt-2 flex flex-wrap gap-3 text-xs">
          <a
            href={PROVIDER_KEY_URLS[provider]}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-400 hover:underline"
          >
            {t('settings.apiKeyGet')}
          </a>
          {active.hasApiKey && (
            <button
              type="button"
              onClick={() => void save({ provider, apiKey: null })}
              className="text-slate-400 hover:text-red-400"
            >
              {t('settings.removeKey')}
            </button>
          )}
        </div>

        <Field label={t('settings.model')} hint={t(`settings.modelHelp.${provider}`)}>
          <Select
            value={customModel ? CUSTOM_MODEL : active.model}
            disabled={loadingModels}
            onChange={(event) => {
              if (event.target.value === CUSTOM_MODEL) {
                setCustomModel(true)
                return
              }
              setCustomModel(false)
              void save({ provider, ttsModel: event.target.value })
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

        {modelsError && <Banner tone="warn">{modelsError}</Banner>}

        {customModel && (
          <div className="flex gap-2">
            <TextInput
              key={`model-${provider}`}
              defaultValue={active.model}
              spellCheck={false}
              placeholder={provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'hexgrad/kokoro-82m'}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== active.model) void save({ provider, ttsModel: value })
              }}
            />
          </div>
        )}

        <Field label={t('settings.voiceLabel')}>
          {voiceOptions.length > 0 ? (
            <Select
              value={active.voice}
              onChange={(event) => void save({ provider, ttsVoice: event.target.value })}
            >
              {voiceOptions.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
              {active.voice && !voiceOptions.some((voice) => voice.id === active.voice) && (
                <option value={active.voice}>{active.voice}</option>
              )}
            </Select>
          ) : (
            <TextInput
              key={`voice-${provider}`}
              defaultValue={active.voice}
              spellCheck={false}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== active.voice) void save({ provider, ttsVoice: value })
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
          <>
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

            {settings.useBrowserVoice && (
              <Field
                label={t('settings.deviceVoice')}
                hint={
                  deviceVoices.length > 0
                    ? t('settings.deviceVoiceHelp')
                    : t('settings.deviceVoiceNone')
                }
              >
                <Select
                  value={deviceVoice ?? ''}
                  disabled={deviceVoices.length === 0}
                  onChange={(event) => {
                    const uri = event.target.value
                    setDeviceVoice(uri)
                    writeVoicePreference(settings.readingLang, uri)
                    setStatus({ tone: 'success', message: t('settings.saved') })
                  }}
                >
                  {deviceVoices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}
                      {voice.localService ? '' : ` · ${t('settings.deviceVoiceOnline')}`}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
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

