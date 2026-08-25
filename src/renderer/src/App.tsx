import { useCallback, useEffect, useState } from 'react'
import { Loader2, PlugZap, RefreshCw } from 'lucide-react'
import { TopNav, type Route } from './components/layout/TopNav.js'
import { Button } from './components/ui/Button.js'
import { CampaignsPage } from './pages/CampaignsPage.js'
import { OnboardingPage } from './pages/OnboardingPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { getReadiness } from './data/api.js'
import { useEngine } from './useEngine.js'
import type { Readiness } from './data/types.js'

type Gate =
  | { phase: 'checking' }
  | { phase: 'engine-down'; message: string }
  | { phase: 'onboarding'; readiness: Readiness }
  | { phase: 'ready'; readiness: Readiness }

export function App(): JSX.Element {
  const { state: engine, restart } = useEngine()
  const [route, setRoute] = useState<Route>('campaigns')
  const [gate, setGate] = useState<Gate>({ phase: 'checking' })

  const check = useCallback(async () => {
    try {
      const readiness = await getReadiness()
      setGate(readiness.ready ? { phase: 'ready', readiness } : { phase: 'onboarding', readiness })
    } catch (error) {
      setGate({ phase: 'engine-down', message: (error as Error).message })
    }
  }, [])

  // Readiness can only be read once the sidecar has finished its handshake, so
  // the check is driven by engine state rather than run once on mount.
  useEffect(() => {
    if (engine.status === 'ready') {
      void check()
    } else if (engine.status === 'crashed' || engine.status === 'unavailable') {
      setGate({
        phase: 'engine-down',
        message: engine.lastError ?? `The engine is ${engine.status}.`
      })
    } else {
      setGate({ phase: 'checking' })
    }
  }, [engine.status, engine.lastError, check])

  if (gate.phase === 'checking') {
    return <Splash message={engineMessage(engine.status)} />
  }

  if (gate.phase === 'engine-down') {
    return (
      <Splash
        message={gate.message}
        failed
        action={
          <Button
            variant="primary"
            onClick={() => void restart()}
            icon={<RefreshCw size={15} strokeWidth={2.2} />}
          >
            Restart the engine
          </Button>
        }
      />
    )
  }

  if (gate.phase === 'onboarding') {
    return (
      <OnboardingPage
        readiness={gate.readiness}
        onReady={(readiness) => setGate({ phase: 'ready', readiness })}
      />
    )
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <TopNav
        route={route}
        onNavigate={setRoute}
        account={gate.readiness.linkedin.account}
      />
      {/* Settings owns its own scroll containers (sidebar + panel), so the shell
          just hands it the remaining height. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {route === 'campaigns' ? (
          <div className="flex-1 overflow-y-auto">
            <CampaignsPage />
          </div>
        ) : (
          <SettingsPage
            onBackToDashboard={() => setRoute('campaigns')}
            onDisconnected={() => void check()}
          />
        )}
      </div>
    </div>
  )
}

function engineMessage(status: string): string {
  if (status === 'starting') return 'Starting the engine…'
  if (status === 'restarting') return 'Restarting the engine…'
  return 'Checking your connections…'
}

function Splash({
  message,
  failed,
  action
}: {
  message: string
  failed?: boolean
  action?: JSX.Element
}): JSX.Element {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas px-8 text-center">
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
          failed ? 'bg-red-50' : 'bg-brand-50'
        }`}
      >
        {failed ? (
          <PlugZap size={24} strokeWidth={2.1} className="text-danger" />
        ) : (
          <Loader2 size={24} strokeWidth={2.1} className="animate-spin text-brand-500" />
        )}
      </span>
      <p className="max-w-[420px] text-[14px] leading-relaxed text-ink-muted">{message}</p>
      {action}
    </div>
  )
}
