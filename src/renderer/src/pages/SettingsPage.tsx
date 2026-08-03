import { useEffect, useState } from 'react'
import { CheckCircle2, Cpu, KeyRound, RefreshCw, Save, Sparkles, XCircle } from 'lucide-react'
import { Badge } from '../components/ui/Badge.js'
import { Button } from '../components/ui/Button.js'
import { Card } from '../components/ui/Card.js'
import { Select, type SelectOption } from '../components/ui/Select.js'
import { Toggle } from '../components/ui/Toggle.js'
import { getSettings, listAiProviders, saveSettings } from '../data/api.js'
import { useEngine } from '../useEngine.js'
import type { AiProviderSummary, OutreachSettings } from '../data/types.js'

/**
 * Settings has no counterpart in the exported design, so it is composed from the
 * same primitives as the campaigns screen. Content is mock-backed like the rest
 * of the UI; only the engine panel reads live state, since that wiring already
 * exists and is the quickest way to confirm the sidecar is healthy.
 */
export function SettingsPage(): JSX.Element {
  const { state, restart } = useEngine()
  const [settings, setSettings] = useState<OutreachSettings | null>(null)
  const [providers, setProviders] = useState<AiProviderSummary[]>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    void getSettings().then(setSettings)
    void listAiProviders().then(setProviders)
  }, [])

  const patch = (changes: Partial<OutreachSettings>): void => {
    setSettings((current) => (current ? { ...current, ...changes } : current))
    setSavedAt(null)
  }

  const onSave = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    await saveSettings(settings)
    setSaving(false)
    setSavedAt(Date.now())
  }

  const providerOptions: SelectOption[] = providers.map((provider) => ({
    value: provider.name,
    label: provider.label
  }))

  const limitOptions: SelectOption[] = [10, 15, 20, 25, 30, 40].map((value) => ({
    value: String(value),
    label: `${value} per day`
  }))

  return (
    <div className="mx-auto max-w-[1040px] px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-tight">Settings</h1>
          <p className="mt-2 text-[15px] text-ink-muted">
            Configure the AI provider, outreach pacing, and the local engine.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-[13px] font-medium text-emerald-600">Saved</span>
          )}
          <Button
            variant="primary"
            onClick={() => void onSave()}
            disabled={saving || !settings}
            icon={<Save size={16} strokeWidth={2.2} />}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="mt-7 space-y-4">
        <Card className="p-6">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} strokeWidth={2.1} className="text-brand-600" />
            <h2 className="text-base font-bold tracking-tight">AI provider</h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            Used for message drafting and campaign pacing.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Default provider</span>
              <Select
                label="Default provider"
                value={settings?.defaultProvider ?? ''}
                options={providerOptions}
                onChange={(value) => patch({ defaultProvider: value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Default model</span>
              <input
                value={settings?.defaultModel ?? ''}
                onChange={(event) => patch({ defaultModel: event.target.value })}
                className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 text-sm transition-colors hover:border-slate-300"
              />
            </label>
          </div>

          <ul className="mt-5 space-y-2">
            {providers.map((provider) => (
              <li
                key={provider.name}
                className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <KeyRound size={16} strokeWidth={2.1} className="shrink-0 text-ink-subtle" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{provider.label}</p>
                    <p className="truncate text-xs text-ink-muted">{provider.defaultModel}</p>
                  </div>
                </div>
                {provider.available ? (
                  <Badge tone="positive" icon={<CheckCircle2 size={12} strokeWidth={2.4} />}>
                    Ready
                  </Badge>
                ) : (
                  <Badge tone="neutral" icon={<XCircle size={12} strokeWidth={2.4} />}>
                    {provider.unavailableReason ?? 'Unavailable'}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-bold tracking-tight">Outreach pacing</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Limits applied across every running campaign.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Daily connection limit</span>
              <Select
                label="Daily connection limit"
                value={String(settings?.dailyConnectionLimit ?? 25)}
                options={limitOptions}
                onChange={(value) => patch({ dailyConnectionLimit: Number(value) })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Working hours start</span>
              <input
                type="time"
                value={settings?.workingHoursStart ?? '09:00'}
                onChange={(event) => patch({ workingHoursStart: event.target.value })}
                className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 text-sm transition-colors hover:border-slate-300"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Working hours end</span>
              <input
                type="time"
                value={settings?.workingHoursEnd ?? '18:00'}
                onChange={(event) => patch({ workingHoursEnd: event.target.value })}
                className="focus-ring h-10 w-full rounded-lg border border-line bg-white px-3 text-sm transition-colors hover:border-slate-300"
              />
            </label>
          </div>

          <div className="mt-2 divide-y divide-line">
            <Toggle
              label="Pause on weekends"
              description="Skip Saturdays and Sundays so activity looks natural."
              checked={settings?.pauseOnWeekends ?? false}
              onChange={(checked) => patch({ pauseOnWeekends: checked })}
            />
            <Toggle
              label="Auto-plan daily targets"
              description="Let the AI adjust each campaign's daily volume based on acceptance rate."
              checked={settings?.autoPlanDailyTargets ?? false}
              onChange={(checked) => patch({ autoPlanDailyTargets: checked })}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2.5">
            <Cpu size={18} strokeWidth={2.1} className="text-ink-muted" />
            <h2 className="text-base font-bold tracking-tight">Engine</h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            The local Python sidecar that runs campaigns and AI calls.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3">
            <Fact label="Status" value={state.status} />
            <Fact label="Version" value={state.version ?? '—'} />
            <Fact label="Python" value={state.python ?? '—'} />
            <Fact label="PID" value={state.pid ? String(state.pid) : '—'} />
            <Fact label="Restarts" value={String(state.restarts)} />
          </div>

          {state.lastError && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
              {state.lastError}
            </p>
          )}

          <div className="mt-5">
            <Button
              onClick={() => void restart()}
              icon={<RefreshCw size={15} strokeWidth={2.2} />}
            >
              Restart engine
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-subtle">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium capitalize tabular-nums">{value}</p>
    </div>
  )
}
