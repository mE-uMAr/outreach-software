import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  Cpu,
  ExternalLink,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import { FieldLabel } from '../ui/Field.js'
import { Select, type SelectOption } from '../ui/Select.js'
import {
  getAuthStatus,
  signInToClaude,
  signOutOfClaude,
  testAiConnection
} from '../../data/api.js'
import { useEngine } from '../../useEngine.js'
import type { AiConnection, ClaudeAuthStatus } from '../../data/types.js'

interface AiConnectionCardProps {
  connection: AiConnection
  onChange: (connection: AiConnection) => void
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; model?: string; latencyMs?: number }
  | { status: 'failed'; message: string }

/** Blank means "let Claude choose", matching the CLI's own default. */
const MODELS: readonly SelectOption[] = [
  { value: '', label: 'Default (recommended)' },
  { value: 'opus', label: 'Opus — highest quality' },
  { value: 'sonnet', label: 'Sonnet — balanced' },
  { value: 'haiku', label: 'Haiku — fastest' }
]

export function AiConnectionCard({ connection, onChange }: AiConnectionCardProps): JSX.Element {
  const { state } = useEngine()
  const [auth, setAuth] = useState<ClaudeAuthStatus | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  const refresh = useCallback(async () => {
    setAuth(await getAuthStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = async (): Promise<void> => {
    setSigningIn(true)
    setAuthUrl(null)
    setTest({ status: 'idle' })
    try {
      setAuth(await signInToClaude((url) => setAuthUrl(url)))
    } finally {
      setSigningIn(false)
      setAuthUrl(null)
    }
  }

  const signOut = async (): Promise<void> => {
    setAuth(await signOutOfClaude())
    setTest({ status: 'idle' })
  }

  const runTest = async (): Promise<void> => {
    setTest({ status: 'testing' })
    const result = await testAiConnection(connection.provider, connection.model)
    setTest(
      result.ok
        ? { status: 'ok', model: result.model, latencyMs: result.latencyMs }
        : { status: 'failed', message: result.error ?? 'Connection failed' }
    )
  }

  const signedIn = Boolean(auth?.loggedIn)
  const notInstalled = auth !== null && !auth.installed

  return (
    <SectionCard
      id="s-ai"
      icon={Sparkles}
      tone="brand"
      title="Claude"
      description="Sign in with your Anthropic account to power drafting and campaign pacing."
      delayMs={300}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------- account */}
        <div className="flex flex-col rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Account
          </p>

          {notInstalled ? (
            <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-amber-50 px-3 py-2.5">
              <TriangleAlert size={14} strokeWidth={2.2} className="mt-px shrink-0 text-warn" />
              <p className="text-[11px] leading-relaxed text-warn">
                Claude is not available on this machine yet. Install it, then sign in here.
              </p>
            </div>
          ) : signedIn ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                  <BadgeCheck size={18} strokeWidth={2.2} className="text-success" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {auth?.email ?? 'Signed in'}
                  </p>
                  <p className="truncate text-[11px] capitalize text-ink-subtle">
                    {[auth?.plan, auth?.organization].filter(Boolean).join(' · ') || 'Connected'}
                  </p>
                </div>
              </div>

              <Button
                className="mt-2.5 w-full justify-center"
                onClick={() => void signOut()}
                icon={<LogOut size={14} strokeWidth={2} />}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Sign in to continue. A browser window opens for authorisation — nothing is typed
                into this app.
              </p>

              <Button
                variant="primary"
                className="mt-3 w-full justify-center"
                onClick={() => void signIn()}
                disabled={signingIn}
                icon={<LogIn size={15} strokeWidth={2.2} />}
              >
                {signingIn ? 'Waiting for authorisation…' : 'Sign in with Claude'}
              </Button>

              {authUrl && (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-brand-500/20 bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-500 hover:bg-brand-100"
                >
                  <ExternalLink size={12} strokeWidth={2.4} />
                  Open the authorisation page
                </a>
              )}
            </>
          )}

          <div className="mt-auto flex items-start gap-2 pt-3">
            <ShieldCheck size={13} strokeWidth={2.2} className="mt-px shrink-0 text-ink-subtle" />
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              This sign-in is stored only for this app and is kept separate from any Claude session
              already on the machine.
            </p>
          </div>
        </div>

        {/* --------------------------------------------------------- model */}
        <div className="flex flex-col rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <FieldLabel hint="Applies to drafting and campaign pacing">Model</FieldLabel>
          <Select
            label="Claude model"
            value={connection.model}
            options={MODELS}
            disabled={!signedIn}
            onChange={(model) => {
              onChange({ ...connection, model })
              setTest({ status: 'idle' })
            }}
          />
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            Default follows your account&apos;s recommended model.
          </p>

          <Button
            className="mt-3 w-full justify-center"
            onClick={() => void runTest()}
            disabled={!signedIn || test.status === 'testing'}
            icon={
              <RefreshCw
                size={14}
                strokeWidth={2}
                className={test.status === 'testing' ? 'animate-spin' : undefined}
              />
            }
          >
            {test.status === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>

          {test.status === 'ok' && (
            <p className="mt-2.5 rounded-lg border border-success/20 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-success">
              Connected{test.model && ` · ${test.model}`}
              {test.latencyMs !== undefined && ` · ${test.latencyMs} ms`}
            </p>
          )}
          {test.status === 'failed' && (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-[11px] font-medium text-danger">
              <TriangleAlert size={12} strokeWidth={2.4} className="mt-px shrink-0" />
              {test.message}
            </p>
          )}

          <div className="mt-auto flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5">
            <Cpu size={14} strokeWidth={2} className="shrink-0 text-ink-subtle" />
            <p className="truncate text-[11px] text-ink-muted">
              Engine <span className="font-semibold capitalize text-ink">{state.status}</span>
              {state.version && ` · v${state.version}`}
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
