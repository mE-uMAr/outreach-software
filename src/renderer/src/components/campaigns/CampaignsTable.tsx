import clsx from 'clsx'
import {
  Briefcase,
  Copy,
  Eye,
  FileUp,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { Badge } from '../ui/Badge.js'
import { IconButton } from '../ui/IconButton.js'
import { Menu } from '../ui/Menu.js'
import { ProgressBar } from '../ui/ProgressBar.js'
import { StatusPill } from '../ui/StatusPill.js'
import { progressOf, type Campaign, type CampaignSource } from '../../data/types.js'

const SOURCE: Record<CampaignSource, { label: string; icon: LucideIcon; tint: string }> = {
  'sales-navigator': {
    label: 'Sales Navigator',
    icon: Briefcase,
    tint: 'bg-violet-50 text-violet-600'
  },
  search: { label: 'Search', icon: SearchIcon, tint: 'bg-sky-50 text-sky-600' },
  'csv-import': { label: 'CSV Import', icon: FileUp, tint: 'bg-emerald-50 text-emerald-600' }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "1 Aug 2026" — built by hand because locale short months vary ("Sept"). */
function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function progressTone(campaign: Campaign): 'brand' | 'warning' | 'neutral' | 'positive' {
  if (campaign.status === 'paused') return 'warning'
  if (campaign.status === 'completed') return 'positive'
  if (campaign.status === 'draft' || campaign.status === 'analyzing') return 'neutral'
  return 'brand'
}

interface CampaignsTableProps {
  campaigns: Campaign[]
  loading: boolean
  onView: (campaign: Campaign) => void
  onEdit: (campaign: Campaign) => void
  onToggleRun: (campaign: Campaign) => void
  onDuplicate: (campaign: Campaign) => void
  onDelete: (campaign: Campaign) => void
}

/**
 * Column widths are fixed rather than content-driven. In the source design the
 * campaign names, the "Sales Navigator" sub-label and the "Auto Planned" badge
 * all wrapped onto extra lines, which made row heights inconsistent.
 */
export function CampaignsTable({
  campaigns,
  loading,
  onView,
  onEdit,
  onToggleRun,
  onDuplicate,
  onDelete
}: CampaignsTableProps): JSX.Element {
  const headCell =
    'whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted'

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] border-collapse">
        <colgroup>
          <col className="w-[252px]" />
          <col className="w-[124px]" />
          <col className="w-[148px]" />
          <col className="w-[146px]" />
          <col className="w-[164px]" />
          <col className="w-[168px]" />
          <col className="w-[118px]" />
          <col className="w-[126px]" />
          <col className="w-[140px]" />
        </colgroup>

        <thead>
          <tr className="border-b border-line bg-slate-50/60">
            <th className={headCell}>Campaign</th>
            <th className={headCell}>Status</th>
            <th className={clsx(headCell, 'text-right')}>Target Prospects</th>
            <th className={headCell}>Daily Target</th>
            <th className={clsx(headCell, 'text-right')}>Connections Sent</th>
            <th className={headCell}>Progress</th>
            <th className={headCell}>Start Date</th>
            <th className={headCell}>Est. End Date</th>
            <th className={clsx(headCell, 'text-right')}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading && campaigns.length === 0 && <LoadingRows />}

          {!loading && campaigns.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-16 text-center">
                <p className="text-sm font-semibold text-ink">No campaigns found</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Try a different search term or clear the status filter.
                </p>
              </td>
            </tr>
          )}

          {campaigns.map((campaign) => {
            const source = SOURCE[campaign.source]
            const SourceIcon = source.icon
            const percent = progressOf(campaign)
            const running = campaign.status === 'running'

            return (
              <tr
                key={campaign.id}
                className="border-b border-line last:border-b-0 transition-colors hover:bg-slate-50/70"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={clsx(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]',
                        source.tint
                      )}
                    >
                      <SourceIcon size={17} strokeWidth={2.1} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" title={campaign.name}>
                        {campaign.name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-muted">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                        {source.label}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <StatusPill status={campaign.status} />
                </td>

                <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                  {campaign.targetProspects.toLocaleString()}
                </td>

                {/* Fixed height so rows without an auto-planned badge line up
                    with the rows that have one. */}
                <td className="px-4 py-3">
                  <div className="flex h-11 flex-col items-start justify-center gap-1">
                    <p className="whitespace-nowrap text-sm font-medium">
                      {campaign.dailyTarget} / Day
                    </p>
                    {campaign.autoPlanned && (
                      <Badge tone="info" icon={<Sparkles size={11} strokeWidth={2.4} />}>
                        Auto Planned
                      </Badge>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  <span className="font-semibold">{campaign.connectionsSent}</span>
                  <span className="text-ink-subtle"> / {campaign.targetProspects}</span>
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <ProgressBar value={percent} tone={progressTone(campaign)} className="flex-1" />
                    <span className="w-9 shrink-0 text-right text-[13px] font-semibold tabular-nums">
                      {percent}%
                    </span>
                  </div>
                </td>

                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink-muted">
                  {formatDate(campaign.startDate)}
                </td>

                <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink-muted">
                  {formatDate(campaign.estimatedEndDate)}
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <IconButton
                      label={`View ${campaign.name}`}
                      icon={<Eye size={16} strokeWidth={2.1} />}
                      onClick={() => onView(campaign)}
                    />
                    <IconButton
                      label={`Edit ${campaign.name}`}
                      icon={<Pencil size={15} strokeWidth={2.1} />}
                      onClick={() => onEdit(campaign)}
                    />
                    <Menu
                      trigger={(triggerProps) => (
                        <IconButton
                          label={`More actions for ${campaign.name}`}
                          icon={<MoreHorizontal size={16} strokeWidth={2.2} />}
                          {...triggerProps}
                        />
                      )}
                      items={[
                        {
                          label: running ? 'Pause campaign' : 'Resume campaign',
                          icon: running ? (
                            <Pause size={15} strokeWidth={2.1} />
                          ) : (
                            <Play size={15} strokeWidth={2.1} />
                          ),
                          onSelect: () => onToggleRun(campaign),
                          disabled: campaign.status === 'completed'
                        },
                        {
                          label: 'Duplicate',
                          icon: <Copy size={15} strokeWidth={2.1} />,
                          onSelect: () => onDuplicate(campaign)
                        },
                        {
                          label: 'Delete',
                          icon: <Trash2 size={15} strokeWidth={2.1} />,
                          tone: 'danger',
                          onSelect: () => onDelete(campaign)
                        }
                      ]}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LoadingRows(): JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <tr key={index} className="border-b border-line last:border-b-0">
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 animate-pulse rounded-[10px] bg-slate-100" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          </td>
          {Array.from({ length: 8 }, (_, cell) => (
            <td key={cell} className="px-4 py-3">
              <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
