import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  Chrome,
  Crown,
  Download,
  Linkedin,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Target,
  TriangleAlert
} from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import {
  getBrowserStatus,
  getLinkedInStatus,
  installBrowserRuntime,
  signInToLinkedIn,
  signOutOfLinkedIn
} from '../../data/api.js'
import type { BrowserRuntimeStatus, LinkedInStatus } from '../../data/types.js'

interface LinkedInAccountCardProps {
  /** Called after a disconnect so the shell can re-gate the app. */
  onDisconnected: () => void
}

type Busy = 'none' | 'connecting' | 'disconnecting' | 'verifying' | 'installing'

export function LinkedInAccountCard({ onDisconnected }: LinkedInAccountCardProps): JSX.Element {
  const [status, setStatus] = useState<LinkedInStatus | null>(null)
  const [browser, setBrowser] = useState<BrowserRuntimeStatus | null>(null)
  const [busy, setBusy] = useState<Busy>('none')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [account, runtime] = await Promise.all([getLinkedInStatus(), getBrowserStatus()])
    setStatus(account)
    setBrowser(runtime)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const withBusy = async (phase: Busy, work: () => Promise<void>): Promise<void> => {
    setBusy(phase)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy('none')
      setMessage(null)
    }
  }

  const connect = (): void =>
    void withBusy('connecting', async () => {
      setStatus(await signInToLinkedIn(setMessage))
    })

  const disconnect = (): void =>
    void withBusy('disconnecting', async () => {
      setStatus(await signOutOfLinkedIn())
      onDisconnected()
    })

  const verify = (): void =>
    void withBusy('verifying', async () => {
      setStatus(await getLinkedInStatus(true))
    })

  const install = (): void =>
    void withBusy('installing', async () => {
      setBrowser(await installBrowserRuntime(setMessage))
    })

  const account = status?.account
  const connected = Boolean(status?.connected)
  const expired = account?.status === 'expired'

  return (
    <SectionCard
      id="s-linkedin"
      icon={Linkedin}
      tone="brand"
      title="LinkedIn Account"
      description="The account every campaign runs as. Outreach is sent from here."
      delayMs={340}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------- account */}
        <div className="flex flex-col rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Connected account
          </p>

          {connected && account ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50">
                  {account.avatarUrl ? (
                    <img src={account.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <BadgeCheck size={20} strokeWidth={2.2} className="text-success" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{account.fullName}</p>
                  <p className="truncate text-[11px] text-ink-subtle">
                    {account.headline || account.publicId || 'LinkedIn member'}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {account.premium && (
                  <Capability icon={Crown} label="Premium" tone="text-amber-600 bg-amber-50" />
                )}
                {account.salesNavigator && (
                  <Capability
                    icon={Target}
                    label="Sales Navigator"
                    tone="text-brand-500 bg-brand-50"
                  />
                )}
                {!account.salesNavigator && (
                  <Capability
                    icon={TriangleAlert}
                    label="No Sales Navigator seat"
                    tone="text-ink-subtle bg-white"
                  />
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1 justify-center"
                  onClick={verify}
                  disabled={busy !== 'none'}
                  icon={
                    <RefreshCw
                      size={14}
                      strokeWidth={2}
                      className={busy === 'verifying' ? 'animate-spin' : undefined}
                    />
                  }
                >
                  {busy === 'verifying' ? 'Checking…' : 'Verify session'}
                </Button>
                <Button
                  variant="danger"
                  className="justify-center"
                  onClick={disconnect}
                  disabled={busy !== 'none'}
                  icon={<LogOut size={14} strokeWidth={2} />}
                >
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              {expired && account ? (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-warn/25 bg-amber-50 px-3 py-2.5">
                  <TriangleAlert size={14} strokeWidth={2.2} className="mt-px shrink-0 text-warn" />
                  <p className="text-[11px] leading-relaxed text-warn">
                    The session for <strong>{account.fullName}</strong> expired. Sign in again to
                    resume campaigns.
                  </p>
                </div>
              ) : (
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  A browser window opens on LinkedIn&apos;s own login page. Your password is never
                  typed into this app.
                </p>
              )}

              <Button
                variant="primary"
                className="mt-3 w-full justify-center"
                onClick={connect}
                disabled={busy !== 'none'}
                icon={<Linkedin size={15} strokeWidth={2.2} />}
              >
                {busy === 'connecting' ? 'Waiting for sign-in…' : 'Connect LinkedIn'}
              </Button>
            </>
          )}

          {busy === 'connecting' && message && (
            <p className="mt-2 flex items-center gap-1.5 rounded-lg border border-brand-500/20 bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-500">
              <Loader2 size={12} strokeWidth={2.4} className="animate-spin" />
              {message}
            </p>
          )}

          {error && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-danger">
              <TriangleAlert size={12} strokeWidth={2.4} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          <div className="mt-auto flex items-start gap-2 pt-3">
            <ShieldCheck size={13} strokeWidth={2.2} className="mt-px shrink-0 text-ink-subtle" />
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              The session is encrypted on this machine and never leaves it. Disconnecting signs
              out on LinkedIn and deletes the local copy.
            </p>
          </div>
        </div>

        {/* ------------------------------------------------ browser runtime */}
        <div className="flex flex-col rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">
            Browser runtime
          </p>

          <div className="flex items-start gap-3 rounded-lg border border-line bg-white px-3 py-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                browser?.installed ? 'bg-emerald-50' : 'bg-canvas'
              }`}
            >
              <Chrome
                size={17}
                strokeWidth={2}
                className={browser?.installed ? 'text-success' : 'text-ink-subtle'}
              />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">
                {browser?.installed ? 'Chromium installed' : 'Chromium not installed'}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">
                {browser?.installed
                  ? 'A private browser, separate from the one you browse with.'
                  : browser?.message || 'Needed before any campaign can run.'}
              </p>
            </div>
          </div>

          {!browser?.installed && (
            <Button
              variant="primary"
              className="mt-3 w-full justify-center"
              onClick={install}
              disabled={busy !== 'none'}
              icon={<Download size={14} strokeWidth={2.2} />}
            >
              {busy === 'installing' ? 'Downloading…' : 'Install browser runtime'}
            </Button>
          )}

          {busy === 'installing' && message && (
            <p className="mt-2 truncate rounded-lg border border-brand-500/20 bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-500">
              {message}
            </p>
          )}

          <p className="mt-auto pt-3 text-[11px] leading-relaxed text-ink-subtle">
            The automation drives this browser with the accessibility tree of each page, falling
            back to a screenshot only when a step needs one — which is what keeps it fast and
            cheap to run.
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

function Capability({
  icon: Icon,
  label,
  tone
}: {
  icon: typeof Crown
  label: string
  tone: string
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      <Icon size={10} strokeWidth={2.6} />
      {label}
    </span>
  )
}
