import clsx from 'clsx'
import {
  BarChart3,
  BellRing,
  CircleCheckBig,
  PlayCircle,
  Send,
  Users,
  type LucideIcon
} from 'lucide-react'
import { Badge, type BadgeTone } from '../ui/Badge.js'
import { Card } from '../ui/Card.js'
import type { CampaignStats } from '../../data/types.js'

interface StatDefinition {
  key: keyof CampaignStats['deltas']
  label: string
  icon: LucideIcon
  iconClass: string
  tone: BadgeTone
  format?: (value: number) => string
}

/** Emoji tiles in the design are replaced with lucide glyphs on tinted plates. */
const STATS: StatDefinition[] = [
  {
    key: 'totalCampaigns',
    label: 'Total Campaigns',
    icon: BarChart3,
    iconClass: 'bg-brand-50 text-brand-600',
    tone: 'positive'
  },
  {
    key: 'activeCampaigns',
    label: 'Active Campaigns',
    icon: PlayCircle,
    iconClass: 'bg-sky-50 text-sky-600',
    tone: 'positive'
  },
  {
    key: 'completedCampaigns',
    label: 'Completed Campaigns',
    icon: CircleCheckBig,
    iconClass: 'bg-emerald-50 text-emerald-600',
    tone: 'positive'
  },
  {
    key: 'totalProspects',
    label: 'Total Prospects',
    icon: Users,
    iconClass: 'bg-violet-50 text-violet-600',
    tone: 'positive',
    format: (value) => value.toLocaleString()
  },
  {
    key: 'connectionsSentToday',
    label: 'Connections Sent Today',
    icon: Send,
    iconClass: 'bg-indigo-50 text-indigo-600',
    tone: 'warning'
  },
  {
    key: 'pendingFollowUps',
    label: 'Pending Follow-ups',
    icon: BellRing,
    iconClass: 'bg-amber-50 text-amber-600',
    tone: 'warning'
  }
]

function StatSkeleton(): JSX.Element {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="h-10 w-10 animate-pulse rounded-[10px] bg-slate-100" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
      </div>
      <div className="mt-4 h-8 w-16 animate-pulse rounded bg-slate-100" />
      <div className="mt-2 h-4 w-28 animate-pulse rounded bg-slate-100" />
    </Card>
  )
}

interface StatsGridProps {
  stats: CampaignStats | null
}

export function StatsGrid({ stats }: StatsGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {STATS.map((definition) => {
        if (!stats) return <StatSkeleton key={definition.key} />

        const Icon = definition.icon
        const value = stats[definition.key as keyof CampaignStats] as number
        const delta = stats.deltas[definition.key]

        return (
          <Card key={definition.key} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <span
                className={clsx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]',
                  definition.iconClass
                )}
              >
                <Icon size={19} strokeWidth={2.1} />
              </span>
              <Badge tone={definition.tone}>{delta}</Badge>
            </div>
            <p className="mt-4 text-[28px] font-bold leading-none tracking-tight">
              {definition.format ? definition.format(value) : value}
            </p>
            {/* The label is the only wrapping text in the card, so the cards in a
                row stay the same height regardless of label length. */}
            <p className="mt-2 text-[13px] font-medium leading-snug text-ink-muted">
              {definition.label}
            </p>
          </Card>
        )
      })}
    </div>
  )
}
