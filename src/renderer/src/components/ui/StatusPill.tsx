import clsx from 'clsx'
import type { CampaignStatus } from '../../data/types.js'

interface StatusConfig {
  label: string
  pill: string
  dot: string
}

const STATUS: Record<CampaignStatus, StatusConfig> = {
  running: { label: 'Running', pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  paused: { label: 'Paused', pill: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  analyzing: { label: 'Analyzing', pill: 'bg-brand-50 text-brand-600', dot: 'bg-brand-500' },
  draft: { label: 'Draft', pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  completed: { label: 'Completed', pill: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' }
}

export function StatusPill({ status }: { status: CampaignStatus }): JSX.Element {
  const config = STATUS[status]
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1',
        'text-xs font-semibold leading-none',
        config.pill
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  )
}

export const STATUS_LABELS = STATUS
