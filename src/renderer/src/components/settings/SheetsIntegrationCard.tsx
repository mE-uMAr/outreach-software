import { useState } from 'react'
import { Check, Plus, RefreshCw, Sheet, Table2, Wifi } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import type { SheetsIntegration } from '../../data/types.js'

interface SheetsIntegrationCardProps {
  sheets: SheetsIntegration
}

export function SheetsIntegrationCard({ sheets }: SheetsIntegrationCardProps): JSX.Element {
  const [testing, setTesting] = useState(false)

  const runTest = async (): Promise<void> => {
    setTesting(true)
    // Stands in for outreach.testSheetConnection.
    await new Promise((resolve) => setTimeout(resolve, 900))
    setTesting(false)
  }

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Status',
      value: sheets.connected ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          Connected
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
          Not connected
        </span>
      )
    },
    { label: 'Last synced', value: sheets.lastSynced },
    { label: 'Rows synced', value: sheets.rowsSynced.toLocaleString() }
  ]

  return (
    <SectionCard
      id="s-sheets"
      icon={Sheet}
      tone="success"
      title="Google Sheets Integration"
      description="Sync campaign data and prospects with your connected spreadsheet."
      delayMs={250}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Connected Sheet
          </p>

          <div className="mb-3 flex gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
              <Table2 size={18} strokeWidth={2} className="text-success" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{sheets.name}</p>
              <p className="truncate text-[11px] text-ink-subtle">{sheets.url}</p>
            </div>
          </div>

          {rows.map((row) => (
            <div key={row.label} className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-muted">{row.label}</span>
              <span className="text-xs font-medium text-ink">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">Actions</p>

          <Button
            className="w-full justify-center"
            onClick={() => void runTest()}
            disabled={testing}
            icon={<Wifi size={14} strokeWidth={2} />}
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          <Button className="w-full justify-center" icon={<RefreshCw size={14} strokeWidth={2} />}>
            Reconnect Sheet
          </Button>
          <Button className="w-full justify-center" icon={<Plus size={14} strokeWidth={2} />}>
            Connect Different Sheet
          </Button>

          <div className="mt-auto flex items-start gap-1.5 rounded-lg border border-success/20 bg-emerald-50 px-3 py-2.5">
            <Check size={13} strokeWidth={3} className="mt-px shrink-0 text-success" />
            <p className="text-[11px] leading-relaxed text-success">
              Auto-sync enabled. Updates every {sheets.autoSyncMinutes} minutes.
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
