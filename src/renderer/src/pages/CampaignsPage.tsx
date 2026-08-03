import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button.js'
import { Card } from '../components/ui/Card.js'
import { CampaignsTable } from '../components/campaigns/CampaignsTable.js'
import { Pagination } from '../components/campaigns/Pagination.js'
import { StatsGrid } from '../components/campaigns/StatsGrid.js'
import { TableToolbar, type StatusFilter } from '../components/campaigns/TableToolbar.js'
import {
  deleteCampaign,
  getCampaignStats,
  listCampaigns,
  setCampaignStatus
} from '../data/api.js'
import type { Campaign, CampaignPage, CampaignSort, CampaignStats } from '../data/types.js'

const PAGE_SIZE = 5

export function CampaignsPage(): JSX.Element {
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [result, setResult] = useState<CampaignPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<CampaignSort>('recent')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    void getCampaignStats().then(setStats)
  }, [reloadToken])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void listCampaigns({ search, status, sort, page, pageSize: PAGE_SIZE }).then((response) => {
      if (cancelled) return
      setResult(response)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [search, status, sort, page, reloadToken])

  // Filtering can shrink the result set below the current page.
  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
    if (page > pageCount) setPage(pageCount)
  }, [result.total, page])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const onFilterChange = useCallback(<T,>(setter: (value: T) => void) => {
    return (value: T): void => {
      setter(value)
      setPage(1)
    }
  }, [])

  const handlers = useMemo(
    () => ({
      onView: (campaign: Campaign) => console.info('view campaign', campaign.id),
      onEdit: (campaign: Campaign) => console.info('edit campaign', campaign.id),
      onDuplicate: (campaign: Campaign) => console.info('duplicate campaign', campaign.id),
      onToggleRun: async (campaign: Campaign) => {
        await setCampaignStatus(campaign.id, campaign.status === 'running' ? 'paused' : 'running')
        reload()
      },
      onDelete: async (campaign: Campaign) => {
        await deleteCampaign(campaign.id)
        reload()
      }
    }),
    [reload]
  )

  return (
    <div className="mx-auto max-w-[1440px] px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-[30px] font-bold leading-tight tracking-tight">
            LinkedIn Outreach Campaigns
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            Manage, monitor, and automate your LinkedIn outreach campaigns with AI-powered planning
            and analytics.
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={17} strokeWidth={2.4} />}>
          New Campaign
        </Button>
      </div>

      <div className="mt-7">
        <StatsGrid stats={stats} />
      </div>

      <div className="mb-3 mt-9 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold tracking-tight">All Campaigns</h2>
        <p className="text-[13px] text-ink-muted">{result.total} total</p>
      </div>

      <Card className="overflow-hidden">
        <TableToolbar
          search={search}
          status={status}
          sort={sort}
          refreshing={loading}
          onSearchChange={onFilterChange(setSearch)}
          onStatusChange={onFilterChange(setStatus)}
          onSortChange={onFilterChange(setSort)}
          onRefresh={reload}
        />

        <CampaignsTable
          campaigns={result.items}
          loading={loading}
          onView={handlers.onView}
          onEdit={handlers.onEdit}
          onDuplicate={handlers.onDuplicate}
          onToggleRun={(campaign) => void handlers.onToggleRun(campaign)}
          onDelete={(campaign) => void handlers.onDelete(campaign)}
        />

        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          onPageChange={setPage}
        />
      </Card>
    </div>
  )
}
