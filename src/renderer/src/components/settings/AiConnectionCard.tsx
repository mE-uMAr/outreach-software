import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Plug,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import { FieldLabel, TextInput } from '../ui/Field.js'
import { Select, type SelectOption } from '../ui/Select.js'
import { listAiProviders, testAiConnection } from '../../data/api.js'
import { useEngine } from '../../useEngine.js'
import type { AiConnection, AiProviderSummary } from '../../data/types.js'

interface AiConnectionCardProps {
  connection: AiConnection
  onChange: (connection: AiConnection) => void
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; message: string; model?: string; latencyMs?: number }
  | { status: 'failed'; message: string }

/** Optional model override; blank means "whatever Claude Code is set to". */
const CLAUDE_MODELS: readonly SelectOption[] = [
  { value: '', label: 'Default (Claude Code setting)' },
  { value: 'opus', label: 'Opus — highest quality' },
  { value: 'sonnet', label: 'Sonnet — balanced' },
  { value: 'haiku', label: 'Haiku — fastest' }
]

export function AiConnectionCard({ connection, onChange }: AiConnectionCardProps): JSX.Element {
  const { state } = useEngine()
  const [providers, setProviders] = useState<AiProviderSummary[]>([])
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  useEffect(() => {
    void listAiProviders().then(setProviders)
  }, [])

  const active = providers.find((provider) => provider.name === connection.provider)
  const isClaudeCode = connection.provider === 'claude-code'
  const needsKey = active?.requiresKey ?? false

  const providerOptions: SelectOption[] = providers.map((provider) => ({
    value: provider.name,
    label: provider.label
  }))

  const runTest = async (): Promise<void> => {
    setTest({ status: 'testing' })
    const result = await testAiConnection(connection.provider, connection.model)
    setTest(
      result.ok
        ? {
            status: 'ok',
            message: result.reply ?? 'Connection verified',
            model: result.model,
            latencyMs: result.latencyMs
          }
        : { status: 'failed', message: result.error ?? 'Connection failed' }
    )
  }

  return (
    <SectionCard
      id="s-ai"
      icon={Plug}
      tone="brand"
      title="AI Connection"
      description="Choose which Claude runs message drafting and campaign pacing."
      delayMs={300}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <FieldLabel hint="Used for every AI action in the app">Provider</FieldLabel>
          <Select
            label="AI provider"
            value={connection.provider}
            options={providerOptions}
            onChange={(provider) => {
              const next = providers.find((item) => item.name === provider)
              onChange({
                ...connection,
                provider,
                model: provider === 'claude-code' ? '' : (next?.defaultModel ?? '')
              })
              setTest({ status: 'idle' })
            }}
          />

          <div className="mt-3.5">
            <FieldLabel hint="Leave on default to use the CLI's own setting">Model</FieldLabel>
            {isClaudeCode ? (
              <Select
                label="Claude model"
                value={connection.model}
                options={CLAUDE_MODELS}
                onChange={(model) => onChange({ ...connection, model })}
              />
            ) : (
              <TextInput
                value={connection.model}
                placeholder={active?.defaultModel ?? 'default'}
                onChange={(event) => onChange({ ...connection, model: event.target.value })}
              />
            )}
          </div>

          {/* Claude Code carries its own auth, so there is no key to collect. */}
          {isClaudeCode ? (
            <div className="mt-3.5 flex items-start gap-2 rounded-lg border border-success/20 bg-emerald-50 px-3 py-2.5">
              <ShieldCheck size={14} strokeWidth={2.2} className="mt-px shrink-0 text-success" />
              <p className="text-[11px] leading-relaxed text-success">
                Signed in through Claude Code with your own subscription. This app never sees or
                stores a credential.
              </p>
            </div>
          ) : (
            needsKey && (
              <div className="mt-3.5">
                <FieldLabel
                  icon={<KeyRound size={15} strokeWidth={2} />}
                  hint="Stored encrypted by your OS keystore"
                >
                  API key
                </FieldLabel>
                <div className="relative">
                  <TextInput
                    type={showKey ? 'text' : 'password'}
                    value={connection.apiKey}
                    placeholder="sk-…"
                    onChange={(event) => onChange({ ...connection, apiKey: event.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShowKey((value) => !value)}
                    className="focus-ring absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle hover:bg-slate-100 hover:text-ink"
                  >
                    {showKey ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                  </button>
                </div>
              </div>
            )
          )}
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
                  <p className="truncate text-[11px] text-ink-subtle">
                    {provider.requiresKey ? 'API key' : 'No key required'}
                  </p>
                </div>
                {provider.available ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                    <CheckCircle2 size={12} strokeWidth={2.4} />
                    Ready
                  </span>
                ) : (
                  <span
                    title={provider.unavailableReason ?? undefined}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-ink-muted"
                  >
                    <XCircle size={12} strokeWidth={2.4} />
                    Unavailable
                  </span>
                )}
              </li>
            ))}
          </ul>

          {isClaudeCode && active && !active.available && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-amber-50 px-3 py-2.5">
              <TerminalSquare size={14} strokeWidth={2.2} className="mt-px shrink-0 text-warn" />
              <p className="text-[11px] leading-relaxed text-warn">
                Claude Code was not found. Install it, run <code>claude login</code>, then test the
                connection again.
              </p>
            </div>
          )}

          <Button
            className="mt-1 w-full justify-center"
            onClick={() => void runTest()}
            disabled={test.status === 'testing'}
            icon={
              <RefreshCw
                size={14}
                strokeWidth={2}
                className={test.status === 'testing' ? 'animate-spin' : undefined}
              />
            }
          >
            {test.status === 'testing' ? 'Testing…' : 'Test Connection'}
          </Button>

          {test.status === 'ok' && (
            <p className="rounded-lg border border-success/20 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-success">
              Connected{test.model && ` · ${test.model}`}
              {test.latencyMs !== undefined && ` · ${test.latencyMs} ms`}
            </p>
          )}
          {test.status === 'failed' && (
            <p className="flex items-start gap-1.5 rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-[11px] font-medium text-danger">
              <TriangleAlert size={12} strokeWidth={2.4} className="mt-px shrink-0" />
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
