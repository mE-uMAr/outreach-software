import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Send,
  Sparkles,
  TriangleAlert,
  Users
} from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { ProgressBar } from '../ui/ProgressBar.js'
import { StatusPill } from '../ui/StatusPill.js'
import { call, subscribe } from '../../data/engine.js'
import { listProspects, setCampaignStatus } from '../../data/api.js'
import { progressOf, type Campaign, type Prospect } from '../../data/types.js'

interface ActivityEntry {
  id: number
  kind: string
  message: string
  createdAt: string
}

interface RunnerState {
  campaignId: string
  status: string
  sentToday: number
  dailyTarget: number
  lastMessage: string
  lastError: string | null
}

interface CampaignDetailModalProps {
  campaign: Campaign | null
  onClose: () => void
  /** Called after anything that changes the campaign, so the table can refresh. */
  onChanged: () => void
}

const PROSPECT_TONE: Record<Prospect['status'], string> = {
  queued: 'text-ink-subtle',
  invited: 'text-brand-500',
  accepted: 'text-success',
  replied: 'text-accent',
  skipped: 'text-ink-subtle',
  failed: 'text-danger'
}

/**
 * What a campaign is actually doing.
 *
 * A running campaign works on its own for hours; without somewhere to watch it,
 * the only evidence it is alive is a counter that moves every ninety seconds.
 * This shows the queue, the trail of what has been sent, and whatever the runner
 * is doing right now — which arrives as notifications while the modal is open.
 */
export function CampaignDetailModal({
  campaign,
  onClose,
  onChanged
}: CampaignDetailModalProps): JSX.Element {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [runner, setRunner] = useState<RunnerState | null>(null)
  const [live, setLive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const id = campaign?.id ?? null

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [people, trail, state] = await Promise.all([
        listProspects(id, 200),
        call<ActivityEntry[]>('outreach.activity', { campaignId: id, limit: 40 }),
        call<RunnerState | null>('outreach.runnerState', { campaignId: id })
      ])
      setProspects(people)
      setActivity(trail)
      setRunner(state)
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    void load()
  }, [id, load])

  // The runner pushes `campaign.*` as it works; without this the modal would
  // only ever show what was true when it opened.
  useEffect(() => {
    if (!id) return
    return subscribe('campaign.', (event) => {
      const params = event.params as { campaignId?: string; message?: string }
      if (params?.campaignId !== id) return
      if (params.message) setLive(params.message)
      if (event.method === 'campaign.progress') void load()
    })
  }, [id, load])

  const toggleRun = async (): Promise<void> => {
    if (!campaign) return
    setBusy(true)
    setError(null)
    try {
      await setCampaignStatus(campaign.id, campaign.status === 'running' ? 'paused' : 'running')
      onChanged()
      await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!campaign) return <Modal open={false} onClose={onClose} title="" children={null} />

  const counts = prospects.reduce<Record<string, number>>((totals, person) => {
    totals[person.status] = (totals[person.status] ?? 0) + 1
    return totals
  }, {})

  const running = campaign.status === 'running'

  return (
    <Modal
      open
      onClose={onClose}
      icon={<Users size={17} strokeWidth={2.2} />}
      title={campaign.name}
      subtitle={`${campaign.targetProspects.toLocaleString()} prospects · ${campaign.dailyTarget}/day`}
      width="max-w-[760px]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StatusPill status={campaign.status} />
            {campaign.searchUrl && (
              <a
                href={campaign.searchUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[12px] font-medium text-brand-500 hover:underline"
              >
                <ExternalLink size={12} strokeWidth={2.4} />
                Open the search
              </a>
            )}
          </div>
          <Button
            variant={running ? 'secondary' : 'primary'}
            onClick={() => void toggleRun()}
            disabled={busy || campaign.status === 'completed'}
            icon={
              busy ? (
                <Loader2 size={15} strokeWidth={2.2} className="animate-spin" />
              ) : running ? (
                <Pause size={15} strokeWidth={2.2} />
              ) : (
                <Play size={15} strokeWidth={2.2} />
              )
            }
          >
            {running ? 'Pause campaign' : 'Start campaign'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-danger">
            <TriangleAlert size={13} strokeWidth={2.4} className="mt-px shrink-0" />
            {error}
          </p>
        )}

        {(runner || live) && (
          <div className="rounded-xl border border-brand-500/20 bg-brand-50 px-4 py-3">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-brand-500">
              {running && <Loader2 size={13} strokeWidth={2.4} className="animate-spin" />}
              {live || runner?.lastMessage || 'Idle'}
            </p>
            {runner && runner.dailyTarget > 0 && (
              <p className="mt-1 text-[11px] text-brand-500/80">
                {runner.sentToday} of {runner.dailyTarget} sent today
              </p>
            )}
            {runner?.lastError && (
              <p className="mt-1 text-[11px] text-danger">{runner.lastError}</p>
            )}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-[12px] font-semibold text-ink">Progress</p>
            <p className="text-[12px] tabular-nums text-ink-muted">
              {campaign.connectionsSent.toLocaleString()} /{' '}
              {campaign.targetProspects.toLocaleString()}
            </p>
          </div>
          <ProgressBar value={progressOf(campaign)} tone={running ? 'brand' : 'neutral'} />
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile icon={Clock} label="Queued" value={counts.queued ?? 0} tone="text-ink" />
          <Tile icon={Send} label="Invited" value={counts.invited ?? 0} tone="text-brand-500" />
          <Tile
            icon={CheckCircle2}
            label="Accepted"
            value={counts.accepted ?? 0}
            tone="text-success"
          />
          <Tile
            icon={MessageSquare}
            label="Replied"
            value={counts.replied ?? 0}
            tone="text-accent"
          />
        </div>

        {campaign.analysis && (
          <div className="rounded-xl border border-line bg-canvas px-4 py-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
              <Sparkles size={12} strokeWidth={2.4} className="text-brand-500" />
              The plan this campaign was approved from
            </p>
            <p className="text-[11px] leading-relaxed text-ink-muted">
              {campaign.analysis.rationale.explanation}
            </p>
          </div>
        )}

        <Panel title="Prospects" count={prospects.length}>
          {prospects.length === 0 ? (
            <Empty message="No prospects queued yet." />
          ) : (
            <ul className="flex flex-col">
              {prospects.slice(0, 60).map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-ink">{person.fullName}</p>
                    {person.headline && (
                      <p className="truncate text-[11px] text-ink-subtle">{person.headline}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-[11px] font-semibold capitalize ${PROSPECT_TONE[person.status]}`}
                    title={person.error ?? undefined}
                  >
                    {person.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Activity" count={activity.length} icon={Activity}>
          {activity.length === 0 ? (
            <Empty message="Nothing has happened on this campaign yet." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3">
                  <span
                    className={`truncate text-[12px] ${
                      entry.kind === 'error' ? 'text-danger' : 'text-ink-muted'
                    }`}
                  >
                    {entry.message}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-subtle">
                    {new Date(entry.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Modal>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Clock
  label: string
  value: number
  tone: string
}): JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5 text-center">
      <Icon size={14} strokeWidth={2.1} className={`mx-auto ${tone}`} />
      <p className={`mt-1 text-[15px] font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] text-ink-muted">{label}</p>
    </div>
  )
}

function Panel({
  title,
  count,
  icon: Icon,
  children
}: {
  title: string
  count: number
  icon?: typeof Activity
  children: JSX.Element
}): JSX.Element {
  return (
    <section className="rounded-xl border border-line bg-white px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
        {Icon && <Icon size={11} strokeWidth={2.4} />}
        {title}
        <span className="font-medium normal-case tracking-normal text-ink-subtle">({count})</span>
      </p>
      <div className="max-h-[220px] overflow-y-auto">{children}</div>
    </section>
  )
}

function Empty({ message }: { message: string }): JSX.Element {
  return <p className="py-3 text-center text-[12px] text-ink-subtle">{message}</p>
}
