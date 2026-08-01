import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400 active:bg-sky-600 font-semibold',
  secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-600',
  ghost: 'text-slate-300 hover:bg-slate-800 active:bg-slate-700',
  danger: 'bg-red-600/90 text-white hover:bg-red-500 active:bg-red-700',
}

export function Button({
  variant = 'secondary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/** Round control used by the player transport. */
export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full transition-colors disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/60 ${className}`}>
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

const CONTROL_CLASS =
  'w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-sky-500'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL_CLASS} ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL_CLASS} ${props.className ?? ''}`} />
}

export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success'
  children: ReactNode
  action?: ReactNode
}) {
  const tones = {
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-100',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    error: 'border-red-500/40 bg-red-500/10 text-red-100',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  }
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${tones[tone]}`}
    >
      <span className="flex-1">{children}</span>
      {action}
    </div>
  )
}
