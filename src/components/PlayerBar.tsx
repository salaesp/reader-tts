import { useEffect, useRef, useState } from 'react'
import type { PlayerState } from '../lib/player'
import { useI18n } from '../i18n'
import { IconButton, Spinner } from './ui'

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
const SLEEP_OPTIONS = [0, 5, 15, 30, 45, 60] as const

export interface PlayerBarProps {
  state: PlayerState
  chunkCount: number
  chapterLabel: string
  rate: number
  canPreviousChapter: boolean
  canNextChapter: boolean
  sleepMinutes: number
  onToggle: () => void
  onPreviousSentence: () => void
  onNextSentence: () => void
  onPreviousChapter: () => void
  onNextChapter: () => void
  onRateChange: (rate: number) => void
  onSleepChange: (minutes: number) => void
}

export function PlayerBar(props: PlayerBarProps) {
  const { t } = useI18n()
  const { state, chunkCount } = props
  const busy = state.status === 'buffering'
  const playing = state.status === 'playing'
  const percent = chunkCount > 0 ? ((state.chunkIndex + 1) / chunkCount) * 100 : 0

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
      <div
        className="h-0.5 bg-sky-500 transition-[width]"
        style={{ width: `${percent}%` }}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      />

      <div
        className="mx-auto flex w-full max-w-3xl items-center gap-1 px-3 py-2.5"
        style={{ paddingBottom: 'calc(0.625rem + var(--safe-bottom))' }}
      >
        <div className="mr-1 min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">{props.chapterLabel}</p>
          <p className="truncate text-xs text-slate-500">
            {busy ? (
              <span className="flex items-center gap-1.5">
                <Spinner className="size-3" /> {t('reader.buffering')}
              </span>
            ) : (
              `${state.chunkIndex + 1} / ${Math.max(1, chunkCount)}`
            )}
          </p>
        </div>

        <IconButton
          label={t('reader.prevChapter')}
          onClick={props.onPreviousChapter}
          disabled={!props.canPreviousChapter}
          className="size-9 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          <ChapterIcon direction="prev" />
        </IconButton>

        <IconButton
          label={t('reader.prevSentence')}
          onClick={props.onPreviousSentence}
          className="size-10 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
        >
          <SkipIcon direction="prev" />
        </IconButton>

        <IconButton
          label={playing ? t('reader.pause') : t('reader.play')}
          onClick={props.onToggle}
          className="size-12 bg-sky-500 text-slate-950 hover:bg-sky-400"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>

        <IconButton
          label={t('reader.nextSentence')}
          onClick={props.onNextSentence}
          className="size-10 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
        >
          <SkipIcon direction="next" />
        </IconButton>

        <IconButton
          label={t('reader.nextChapter')}
          onClick={props.onNextChapter}
          disabled={!props.canNextChapter}
          className="size-9 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        >
          <ChapterIcon direction="next" />
        </IconButton>

        <SpeedMenu rate={props.rate} onChange={props.onRateChange} />
        <SleepMenu minutes={props.sleepMinutes} onChange={props.onSleepChange} />
      </div>
    </div>
  )
}

function SpeedMenu({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useCloseOnOutsideClick(() => setOpen(false))

  return (
    <div className="relative" ref={ref}>
      <IconButton
        label={t('reader.speed')}
        onClick={() => setOpen((value) => !value)}
        className="h-9 min-w-11 px-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
      >
        {rate}×
      </IconButton>

      {open && (
        <ul className="absolute bottom-11 right-0 w-24 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl">
          {SPEEDS.map((speed) => (
            <li key={speed}>
              <button
                type="button"
                onClick={() => {
                  onChange(speed)
                  setOpen(false)
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                  speed === rate ? 'text-sky-400' : 'text-slate-200'
                }`}
              >
                {speed}×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SleepMenu({
  minutes,
  onChange,
}: {
  minutes: number
  onChange: (minutes: number) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useCloseOnOutsideClick(() => setOpen(false))

  return (
    <div className="relative" ref={ref}>
      <IconButton
        label={t('reader.sleepTimer')}
        onClick={() => setOpen((value) => !value)}
        className={`size-9 hover:bg-slate-800 ${minutes > 0 ? 'text-sky-400' : 'text-slate-400'}`}
      >
        <MoonIcon />
      </IconButton>

      {open && (
        <ul className="absolute bottom-11 right-0 w-36 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl">
          {SLEEP_OPTIONS.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                  option === minutes ? 'text-sky-400' : 'text-slate-200'
                }`}
              >
                {option === 0 ? t('reader.sleepOff') : t('reader.sleepMinutes', { n: option })}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function useCloseOnOutsideClick(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return ref
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-6">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-6">
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  )
}

function SkipIcon({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`size-5 ${direction === 'prev' ? 'rotate-180' : ''}`}
    >
      <path d="M6 6l8 6-8 6zM16 6h2.5v12H16z" />
    </svg>
  )
}

function ChapterIcon({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`size-4 ${direction === 'prev' ? 'rotate-180' : ''}`}
    >
      <path d="M6 4l8 8-8 8M16 4v16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" strokeLinejoin="round" />
    </svg>
  )
}
