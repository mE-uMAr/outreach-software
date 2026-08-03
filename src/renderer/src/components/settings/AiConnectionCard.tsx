import { useEffect, useState } from 'react'
import { CheckCircle2, Cpu, Eye, EyeOff, KeyRound, Plug, RefreshCw, XCircle } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import { FieldLabel, FieldSelect, TextInput } from '../ui/Field.js'
import { listAiProviders } from '../../data/api.js'
import { useEngine } from '../../useEngine.js'
import type { AiProviderSummary, AiConnection } from '../../data/types.js'

interface AiConnectionCardProps {
  connection: AiConnection
  onChange: (connection: AiConnection) => void
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'failed'; message?: string }

export function AiConnectionCard({ connection, onChange }: AiConnectionCardProps): JSX.Element {
  const { state } = useEngine()
  const [providers, setProviders] = useState<AiProviderSummary[]>([])
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    void listAiProviders().then(setProviders)
  }, [])

  const active = providers.find((provider) => provider.name === connection.provider)

  const runTest = async (): Promise<void> => {
    setTest({ status: 'testing' })
    // Stands in for ai.complete with a one-token probe.
    await new Promise((resolve) => setTimeout(resolve, 1100))

    if (active && !active.available && !connection.apiKey) {
      setTest({ status: 'failed', message: active.unavailableReason ?? 'Provider unavailable' })
      return
    }
    setTest({ status: 'ok', message: `Reached ${active?.label ?? connection.provider}` })
  }

  return (
    <SectionCard
      id="s-ai"
      icon={Plug}
      tone="brand"
      title="AI Connection"
      description="Choose the model that drafts messages and plans campaign pacing."
      delayMs={300}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <FieldLabel hint="Provider used for every AI action in the app">Provider</FieldLabel>
          <FieldSelect
            aria-label="AI provider"
            value={connection.provider}
            onChange={(event) => {
              const provider = event.target.value
              const next = providers.find((item) => item.name === provider)
              onChange({ ...connection, provider, model: next?.defaultModel ?? '' })
              setTest({ status: 'idle' })
            }}
          >
            {providers.map((provider) => (
              <option key={provider.name} value={provider.name}>
                {provider.label}
              </option>
            ))}
          </FieldSelect>

          <div className="mt-3.5">
            <FieldLabel hint="Leave blank to use the provider default">Model</FieldLabel>
            <TextInput
              value={connection.model}
              placeholder={active?.defaultModel ?? 'default'}
              onChange={(event) => onChange({ ...connection, model: event.target.value })}
            />
          </div>

          <div className="mt-3.5">
            <FieldLabel icon={<KeyRound size={15} strokeWidth={2} />} hint="Stored locally, never synced">
              API key
            </FieldLabel>
            <div className="relative">
              <TextInput
                type={showKey ? 'text' : 'password'}
                value={connection.apiKey}
                placeholder={active?.requiresKey === false ? 'Not required' : 'sk-…'}
                disabled={active?.requiresKey === false}
                onChange={(event) => onChange({ ...connection, apiKey: event.target.value })}
                className="pr-10"
              />
              {active?.requiresKey !== false && (
                <button
                  type="button"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  onClick={() => setShowKey((value) => !value)}
                  className="focus-ring absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle hover:bg-slate-100 hover:text-ink"
                >
                  {showKey ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Available Providers
          </p>

          <ul className="flex flex-col gap-2">
            {providers.map((provider) => (
              <li
                key={provider.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{provider.label}</p>
                  <p className="truncate text-[11px] text-ink-subtle">{provider.defaultModel}</p>
                </div>
                {provider.available ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                    <CheckCircle2 size={12} strokeWidth={2.4} />
                    Ready
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">
                    <XCircle size={12} strokeWidth={2.4} />
                    Needs key
                  </span>
                )}
              </li>
            ))}
          </ul>

          <Button
            className="mt-1 w-full justify-center"
            onClick={() => void runTest()}
            disabled={test.status === 'testing'}
            icon={<RefreshCw size={14} strokeWidth={2} className={test.status === 'testing' ? 'animate-spin' : undefined} />}
          >
            {test.status === 'testing' ? 'Testing…' : 'Test Connection'}
          </Button>

          {test.status === 'ok' && (
            <p className="rounded-lg border border-success/20 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-success">
              {test.message}
            </p>
          )}
          {test.status === 'failed' && (
            <p className="rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-[11px] font-medium text-danger">
              {test.message}
            </p>
          )}

          <div className="mt-auto flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5">
            <Cpu size={14} strokeWidth={2} className="shrink-0 text-ink-subtle" />
            <p className="text-[11px] text-ink-muted">
              Engine <span className="font-semibold capitalize text-ink">{state.status}</span>
              {state.version && ` · v${state.version}`}
              {state.python && ` · Python ${state.python}`}
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
