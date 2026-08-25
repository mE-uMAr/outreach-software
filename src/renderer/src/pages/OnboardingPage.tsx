import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Chrome,
  ExternalLink,
  Linkedin,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import { Logo } from '../components/layout/Logo.js'
import { Button } from '../components/ui/Button.js'
import {
  getReadiness,
  installBrowserRuntime,
  signInToClaude,
  signInToLinkedIn,
  cancelLinkedInSignIn,
  cancelClaudeSignIn
} from '../data/api.js'
import type { Readiness } from '../data/types.js'

interface OnboardingPageProps {
  readiness: Readiness
  onReady: (readiness: Readiness) => void
}

type StepId = 'ai' | 'linkedin' | 'browser'

type StepState =
  | { status: 'idle' }
  | { status: 'working'; message: string; url?: string }
  | { status: 'failed'; message: string }

const IDLE: StepState = { status: 'idle' }

/**
 * The gate.
 *
 * Nothing in the app works without both connections — Claude does the thinking,
 * the LinkedIn session does the acting — so rather than letting the user in and
 * failing on the first click, entry is blocked until both are real.
 *
 * The browser runtime is shown here too but does not block: it is only needed
 * once a campaign runs, and a 150 MB download should not stand between someone
 * and their first look at the product.
 */
export function OnboardingPage({ readiness, onReady }: OnboardingPageProps): JSX.Element {
  const [state, setState] = useState<Readiness>(readiness)
  const [active, setActive] = useState<StepId | null>(null)
  const [steps, setSteps] = useState<Record<StepId, StepState>>({
    ai: IDLE,
    linkedin: IDLE,
    browser: IDLE
  })

  useEffect(() => setState(readiness), [readiness])

  const setStep = useCallback((id: StepId, next: StepState) => {
    setSteps((current) => ({ ...current, [id]: next }))
  }, [])

  const refresh = useCallback(async (): Promise<Readiness> => {
    const next = await getReadiness()
    setState(next)
    return next
  }, [])

  const run = useCallback(
    async (id: StepId, work: () => Promise<unknown>) => {
      setActive(id)
      setStep(id, { status: 'working', message: 'Starting…' })
      try {
        await work()
        setStep(id, IDLE)
        const next = await refresh()
        if (next.ready) onReady(next)
      } catch (error) {
        setStep(id, { status: 'failed', message: (error as Error).message })
      } finally {
        setActive(null)
      }
    },
    [onReady, refresh, setStep]
  )

  const connectClaude = (): void => {
    void run('ai', () =>
      signInToClaude(
        (url) => setStep('ai', { status: 'working', message: 'Waiting for authorisation…', url }),
        (line) => setStep('ai', { status: 'working', message: line })
      )
    )
  }

  const connectLinkedIn = (): void => {
    void run('linkedin', () =>
      signInToLinkedIn((message) => setStep('linkedin', { status: 'working', message }))
    )
  }

  const installBrowser = (): void => {
    void run('browser', () =>
      installBrowserRuntime((line) => setStep('browser', { status: 'working', message: line }))
    )
  }

  const cancel = (id: StepId): void => {
    if (id === 'ai') void cancelClaudeSignIn()
    if (id === 'linkedin') void cancelLinkedInSignIn()
  }

  const done = [state.ai.ready, state.linkedin.ready].filter(Boolean).length

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-6 py-12">
      <div className="w-full max-w-[640px]">
        <header className="mb-8 text-center">
          <Logo size={56} className="mx-auto mb-4 rounded-2xl shadow-lg shadow-brand-500/25" />
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-ink">
            Connect your accounts
          </h1>
          <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-relaxed text-ink-muted">
            LinkedIn Outreach works as you, on your own accounts. Both connections are
            needed before campaigns can be built.
          </p>

          <div className="mx-auto mt-5 flex max-w-[280px] items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-out"
                style={{ width: `${(done / 2) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-ink-subtle">
              {done}/2
            </span>
          </div>
        </header>

        <div className="flex flex-col gap-3">
          <StepCard
            id="ai"
            icon={Sparkles}
            title="Claude"
            subtitle="Powers campaign planning, page understanding and message drafting."
            connected={state.ai.ready}
            connectedLabel={state.ai.email ?? 'Signed in'}
            connectedDetail={
              [state.ai.plan, state.ai.organization].filter(Boolean).join(' · ') || undefined
            }
            state={steps.ai}
            busy={active === 'ai'}
            disabled={active !== null && active !== 'ai'}
            action="Sign in with Claude"
            onConnect={connectClaude}
            onCancel={() => cancel('ai')}
            blocked={
              !state.ai.installed
                ? 'Claude is not installed on this machine. Install it, then sign in here.'
                : undefined
            }
          />

          <StepCard
            id="linkedin"
            icon={Linkedin}
            title="LinkedIn"
            subtitle="A browser window opens and you sign in to LinkedIn directly. Your password is never typed into this app."
            connected={state.linkedin.ready}
            connectedLabel={state.linkedin.account?.fullName ?? 'Connected'}
            connectedDetail={state.linkedin.account?.headline || undefined}
            avatar={state.linkedin.account?.avatarUrl ?? undefined}
            state={steps.linkedin}
            busy={active === 'linkedin'}
            disabled={active !== null && active !== 'linkedin'}
            action="Connect LinkedIn"
            onConnect={connectLinkedIn}
            onCancel={() => cancel('linkedin')}
          />

          <StepCard
            id="browser"
            icon={Chrome}
            title="Browser runtime"
            subtitle="A private Chromium the automation drives. About 150 MB, downloaded once."
            connected={state.browser.ready}
            connectedLabel="Installed"
            state={steps.browser}
            busy={active === 'browser'}
            disabled={active !== null && active !== 'browser'}
            action="Install now"
            optional
            onConnect={installBrowser}
            onCancel={() => undefined}
          />
        </div>

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3.5">
          <ShieldCheck size={15} strokeWidth={2.2} className="mt-px shrink-0 text-ink-subtle" />
          <p className="text-[12px] leading-relaxed text-ink-subtle">
            Both sessions are stored encrypted on this machine and never leave it. The Claude
            session is kept separate from any Claude login already on this computer, and
            signing out here deletes both.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-ink-subtle transition-colors hover:text-ink"
          >
            <RefreshCw size={13} strokeWidth={2.2} />
            Re-check
          </button>

          <Button
            variant="primary"
            disabled={!state.ready}
            onClick={() => onReady(state)}
            icon={<ArrowRight size={16} strokeWidth={2.2} className="order-2" />}
            className="[&>svg]:order-2"
          >
            {state.ready ? 'Enter the app' : `Connect ${2 - done} more`}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface StepCardProps {
  id: StepId
  icon: LucideIcon
  title: string
  subtitle: string
  connected: boolean
  connectedLabel?: string
  connectedDetail?: string
  avatar?: string
  state: StepState
  busy: boolean
  disabled: boolean
  action: string
  optional?: boolean
  blocked?: string
  onConnect: () => void
  onCancel: () => void
}

function StepCard({
  icon: Icon,
  title,
  subtitle,
  connected,
  connectedLabel,
  connectedDetail,
  avatar,
  state,
  busy,
  disabled,
  action,
  optional,
  blocked,
  onConnect,
  onCancel
}: StepCardProps): JSX.Element {
  return (
    <section
      className={`rounded-card border bg-white px-5 py-4 transition-colors ${
        connected ? 'border-success/30 bg-emerald-50/40' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ${
            connected ? 'bg-emerald-100' : 'bg-brand-50'
          }`}
        >
          {connected && avatar ? (
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : connected ? (
            <BadgeCheck size={20} strokeWidth={2.2} className="text-success" />
          ) : (
            <Icon size={19} strokeWidth={2.1} className="text-brand-500" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold tracking-tight text-ink">{title}</h2>
            {optional && !connected && (
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Optional for now
              </span>
            )}
            {connected && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
                <Check size={12} strokeWidth={3} />
                Connected
              </span>
            )}
          </div>

          {connected ? (
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">
              <span className="font-medium text-ink">{connectedLabel}</span>
              {connectedDetail && ` · ${connectedDetail}`}
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{subtitle}</p>
          )}

          {blocked && !connected && (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-warn/25 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-warn">
              <TriangleAlert size={12} strokeWidth={2.4} className="mt-px shrink-0" />
              {blocked}
            </p>
          )}

          {state.status === 'working' && (
            <div className="mt-2.5 rounded-lg border border-brand-500/20 bg-brand-50 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-brand-500">
                <Loader2 size={12} strokeWidth={2.4} className="animate-spin" />
                {state.message}
              </p>
              {state.url && (
                <a
                  href={state.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-brand-500 underline underline-offset-2"
                >
                  <ExternalLink size={11} strokeWidth={2.4} />
                  Open the authorisation page
                </a>
              )}
            </div>
          )}

          {state.status === 'failed' && (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-danger">
              <TriangleAlert size={12} strokeWidth={2.4} className="mt-px shrink-0" />
              {state.message}
            </p>
          )}
        </div>

        {!connected && (
          <div className="shrink-0 pt-0.5">
            {busy ? (
              <Button onClick={onCancel}>Cancel</Button>
            ) : (
              <Button
                variant={optional ? 'secondary' : 'primary'}
                onClick={onConnect}
                disabled={disabled || Boolean(blocked)}
              >
                {action}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
