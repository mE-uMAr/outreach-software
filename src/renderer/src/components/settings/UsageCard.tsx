import { useCallback, useEffect, useState } from 'react'
import { Gauge, RefreshCw, Trash2, Zap } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import { call } from '../../data/engine.js'
import { getUsage } from '../../data/api.js'
import type { UsageSummary } from '../../data/types.js'

const WINDOWS = [7, 30, 90] as const

/**
 * What the automation actually costs.
 *
 * The interesting number is not the total — it is the cache hit rate. Every hit
 * is a page the agent understood without paying a model, and on a campaign that
 * visits the same three page types a thousand times it is the difference between
 * cents and dollars.
 */
export function UsageCard(): JSX.Element {
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [days, setDays] = useState<number>(30)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (window: number) => {
    setBusy(true)
    try {
      setUsage(await getUsage(window))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const clearCache = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('browser.clearPlanCache')
      await load(days)
    } finally {
      setBusy(false)
    }
  }

  const currency = (value: number): string =>
    value >= 0.01 ? `$${value.toFixed(2)}` : value > 0 ? `$${value.toFixed(4)}` : '$0.00'

  return (
    <SectionCard
      id="s-usage"
      icon={Gauge}
      tone="accent"
      title="AI Usage & Cost"
      description="What Claude has been asked to do, and how much of it never needed a model call."
      delayMs={360}
      aside={
        <div className="flex items-center gap-1 rounded-lg bg-canvas p-0.5">
          {WINDOWS.map((window) => (
            <button
              key={window}
              onClick={() => setDays(window)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                days === window ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink'
              }`}
            >
              {window}d
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Spend" value={currency(usage?.costUsd ?? 0)} tone="text-ink" />
        <Tile label="Model calls" value={String(usage?.calls ?? 0)} tone="text-ink" />
        <Tile
          label="Calls avoided"
          value={String(usage?.cacheHits ?? 0)}
          tone="text-success"
          hint={usage ? `${Math.round(usage.cacheHitRate * 100)}% of decisions` : undefined}
        />
        <Tile
          label="Needed a screenshot"
          value={usage ? `${Math.round(usage.screenshotRate * 100)}%` : '0%'}
          tone="text-brand-500"
          hint="the rest read the page as text"
        />
      </div>

      {usage && usage.byPurpose.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Where it went
          </p>
          <ul className="flex flex-col gap-1.5">
            {usage.byPurpose.map((row) => (
              <li key={row.purpose} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-ink">{PURPOSE_LABELS[row.purpose] ?? row.purpose}</span>
                <span className="shrink-0 tabular-nums text-ink-subtle">
                  {row.calls} · {currency(row.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-[18px] py-3.5">
        <p className="flex items-center gap-2 text-[12px] text-ink-muted">
          <Zap size={14} strokeWidth={2.1} className="shrink-0 text-accent" />
          {usage?.cachedPlans ?? 0} page layouts remembered. Clear these after LinkedIn changes
          its design.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => void load(days)}
            disabled={busy}
            icon={<RefreshCw size={13} strokeWidth={2} className={busy ? 'animate-spin' : undefined} />}
          >
            Refresh
          </Button>
          <Button
            variant="danger"
            onClick={() => void clearCache()}
            disabled={busy}
            icon={<Trash2 size={13} strokeWidth={2} />}
          >
            Clear cache
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

const PURPOSE_LABELS: Record<string, string> = {
  'browser.decide': 'Deciding what to click',
  'campaign.plan': 'Planning campaigns',
  'outreach.draft': 'Drafting messages',
  general: 'Other'
}

function Tile({
  label,
  value,
  tone,
  hint
}: {
  label: string
  value: string
  tone: string
  hint?: string
}): JSX.Element {
  return (
    <div className="rounded-[10px] border border-line bg-canvas px-3.5 py-3">
      <p className={`text-[19px] font-bold tabular-nums leading-tight ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium text-ink-muted">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-ink-subtle">{hint}</p>}
    </div>
  )
}
