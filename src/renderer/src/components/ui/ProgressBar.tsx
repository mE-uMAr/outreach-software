import clsx from 'clsx'

interface ProgressBarProps {
  value: number
  /** Matches the row's status so a paused campaign reads amber, not blue. */
  tone?: 'brand' | 'warning' | 'neutral' | 'positive'
  className?: string
}

const TONES = {
  brand: 'bg-brand-600',
  warning: 'bg-amber-500',
  neutral: 'bg-slate-300',
  positive: 'bg-emerald-500'
} as const

export function ProgressBar({ value, tone = 'brand', className }: ProgressBarProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80', className)}
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', TONES[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
