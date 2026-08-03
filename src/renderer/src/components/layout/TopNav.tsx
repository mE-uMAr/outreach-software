import clsx from 'clsx'
import { LayoutGrid, Linkedin, Settings } from 'lucide-react'

export type Route = 'campaigns' | 'settings'

const NAV_ITEMS: { route: Route; label: string; icon: typeof LayoutGrid }[] = [
  { route: 'campaigns', label: 'Campaigns', icon: LayoutGrid },
  { route: 'settings', label: 'Settings', icon: Settings }
]

interface TopNavProps {
  route: Route
  onNavigate: (route: Route) => void
}

export function TopNav({ route, onNavigate }: TopNavProps): JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-600 text-white">
            <Linkedin size={19} strokeWidth={2.25} fill="currentColor" />
          </span>
          <span className="truncate text-[15px] font-bold tracking-tight">LinkedIn Outreach</span>
        </div>

        <nav className="mx-auto flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = route === item.route
            return (
              <button
                key={item.route}
                onClick={() => onNavigate(item.route)}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'focus-ring flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-brand-50 text-brand-600'
                    : 'text-ink-muted hover:bg-slate-100 hover:text-ink'
                )}
              >
                <Icon size={17} strokeWidth={2.1} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <button
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white"
          aria-label="Account — Aisha"
          title="Aisha"
        >
          A
        </button>
      </div>
    </header>
  )
}
