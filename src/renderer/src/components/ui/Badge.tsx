import clsx from 'clsx'
import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'info' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  positive: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  info: 'bg-brand-50 text-brand-600',
  danger: 'bg-red-50 text-red-600'
}

interface BadgeProps {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Pill label. `whitespace-nowrap` is deliberate — in the source design these
 * wrapped onto two lines inside table cells.
 */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps): JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1',
        'text-[11px] font-semibold leading-none',
        TONES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  )
}
