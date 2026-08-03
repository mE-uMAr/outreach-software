import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type SectionTone = 'brand' | 'success' | 'warn' | 'accent'

const TONES: Record<SectionTone, { tile: string; icon: string }> = {
  brand: { tile: 'bg-brand-50', icon: 'text-brand-500' },
  success: { tile: 'bg-emerald-50', icon: 'text-success' },
  warn: { tile: 'bg-amber-100', icon: 'text-warn' },
  accent: { tile: 'bg-violet-50', icon: 'text-accent' }
}

interface SectionCardProps {
  id: string
  icon: LucideIcon
  tone: SectionTone
  title: string
  description: string
  /** Rendered on the right of the header — e.g. the schedule's summary figures. */
  aside?: ReactNode
  children: ReactNode
  /** Message Templates draws its own padding because of the accordion rows. */
  bare?: boolean
  delayMs?: number
}

export function SectionCard({
  id,
  icon: Icon,
  tone,
  title,
  description,
  aside,
  children,
  bare = false,
  delayMs = 0
}: SectionCardProps): JSX.Element {
  const colors = TONES[tone]

  return (
    <section
      id={id}
      style={{ animationDelay: `${delayMs}ms` }}
      className="animate-fadeIn scroll-mt-5 rounded-card border border-line bg-white shadow-card transition-shadow hover:shadow-cardHover"
    >
      <div
        className={clsx(
          'flex items-start justify-between gap-6',
          bare ? 'px-7 pb-5 pt-6' : 'px-7 pb-5 pt-6'
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className={clsx(
                'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg',
                colors.tile
              )}
            >
              <Icon size={17} strokeWidth={2} className={colors.icon} />
            </span>
            <h2 className="text-[15px] font-bold text-ink">{title}</h2>
          </div>
          <p className="ml-11 mt-1 text-[13px] text-ink-muted">{description}</p>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>

      <div className={bare ? '' : 'px-7 pb-6'}>{children}</div>
    </section>
  )
}
