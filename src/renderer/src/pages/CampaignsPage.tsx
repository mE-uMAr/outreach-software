import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/Button.js'
import { Card } from '../components/ui/Card.js'
import { CampaignsTable } from '../components/campaigns/CampaignsTable.js'
import { Pagination } from '../components/campaigns/Pagination.js'
import { StatsGrid } from '../components/campaigns/StatsGrid.js'
import { TableToolbar, type StatusFilter } from '../components/campaigns/TableToolbar.js'
import { CreateCampaignModal } from '../components/campaigns/CreateCampaignModal.js'
import {
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaignStats,
  importProspects,
  listCampaigns,
  setCampaignStatus
} from '../data/api.js'
import type {
  Campaign,
  CampaignAnalysis,
  CampaignPage,
  CampaignSort,
  CampaignStats
} from '../data/types.js'

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
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<CampaignSort>('recent')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void getCampaignStats()
      .then(setStats)
      .catch((caught: Error) => setError(caught.message))
  }, [reloadToken])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void listCampaigns({ search, status, sort, page, pageSize: PAGE_SIZE })
      .then((response) => {
        if (cancelled) return
        setResult(response)
        setError(null)
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
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

  const onCampaignCreated = useCallback(
    async (analysis: CampaignAnalysis, name: string) => {
      const campaign = await createCampaign({
        name,
        source: analysis.source,
        searchUrl: analysis.searchUrl,
        targetProspects: analysis.targetProspects,
        dailyTarget: analysis.dailyConnections,
        autoPlanned: true,
        estimatedEndDate: analysis.expectedCompletion,
        analysis
      })

      setCreating(false)
      // A new campaign is the newest one, so show it at the top of page one.
      setSort('recent')
      setStatus('all')
      setSearch('')
      setPage(1)
      reload()

      // Queueing the prospects walks the search in a real browser and takes a
      // while, so the campaign is already visible before this starts.
      void importProspects(campaign.id, analysis.searchUrl)
        .then(reload)
        .catch((caught: Error) =>
          setError(`Campaign created, but importing prospects failed: ${caught.message}`)
        )
    },
    [reload]
  )

  const onFilterChange = useCallback(<T,>(setter: (value: T) => void) => {
    return (value: T): void => {
      setter(value)
      setPage(1)
    }
  }, [])

  const guard = useCallback(
    async (work: () => Promise<unknown>) => {
      try {
        await work()
        reload()
      } catch (caught) {
        setError((caught as Error).message)
      }
    },
    [reload]
  )

  const handlers = useMemo(
    () => ({
      onView: (campaign: Campaign) => {
        if (campaign.searchUrl) window.open(campaign.searchUrl, '_blank', 'noreferrer')
      },
      onEdit: (campaign: Campaign) => {
        if (campaign.searchUrl) window.open(campaign.searchUrl, '_blank', 'noreferrer')
      },
      onDuplicate: (campaign: Campaign) => void guard(() => duplicateCampaign(campaign.id)),
      onToggleRun: (campaign: Campaign) =>
        void guard(() =>
          setCampaignStatus(campaign.id, campaign.status === 'running' ? 'paused' : 'running')
        ),
      onDelete: (campaign: Campaign) => void guard(() => deleteCampaign(campaign.id))
    }),
    [guard]
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
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          icon={<Plus size={17} strokeWidth={2.4} />}
        >
          New Campaign
        </Button>
      </div>

      {error && (
        <div className="mt-5 flex items-start justify-between gap-4 rounded-xl border border-danger/20 bg-red-50 px-4 py-3">
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-danger">
            <TriangleAlert size={15} strokeWidth={2.2} className="mt-px shrink-0" />
            {error}
          </p>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-[12px] font-semibold text-danger underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

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
          onToggleRun={handlers.onToggleRun}
          onDelete={handlers.onDelete}
        />

        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          onPageChange={setPage}
        />
      </Card>

      <CreateCampaignModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(analysis, name) => void onCampaignCreated(analysis, name)}
      />
    </div>
  )
}
