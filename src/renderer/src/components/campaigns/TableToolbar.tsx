import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '../ui/IconButton.js'
import { SearchInput } from '../ui/SearchInput.js'
import { Select, type SelectOption } from '../ui/Select.js'
import type { CampaignSort, CampaignStatus } from '../../data/types.js'

export type StatusFilter = CampaignStatus | 'all'

const STATUS_OPTIONS: readonly SelectOption<StatusFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'analyzing', label: 'Analyzing' },
  { value: 'draft', label: 'Draft' },
  { value: 'completed', label: 'Completed' }
]

const SORT_OPTIONS: readonly SelectOption<CampaignSort>[] = [
  { value: 'recent', label: 'Recently Created' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'progress', label: 'Progress' },
  { value: 'prospects', label: 'Target Prospects' }
]

interface TableToolbarProps {
  search: string
  status: StatusFilter
  sort: CampaignSort
  refreshing: boolean
  onSearchChange: (value: string) => void
  onStatusChange: (value: StatusFilter) => void
  onSortChange: (value: CampaignSort) => void
  onRefresh: () => void
}

export function TableToolbar({
  search,
  status,
  sort,
  refreshing,
  onSearchChange,
  onStatusChange,
  onSortChange,
  onRefresh
}: TableToolbarProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Search campaign…"
        className="min-w-[220px] flex-1"
      />
      <Select
        label="Filter by status"
        value={status}
        options={STATUS_OPTIONS}
        onChange={onStatusChange}
        className="w-[148px]"
      />
      <Select
        label="Sort campaigns"
        value={sort}
        options={SORT_OPTIONS}
        onChange={onSortChange}
        className="w-[190px]"
      />
      <IconButton
        label="Refresh campaigns"
        onClick={onRefresh}
        disabled={refreshing}
        icon={
          <RefreshCw size={16} strokeWidth={2.1} className={clsx(refreshing && 'animate-spin')} />
        }
      />
    </div>
  )
}
