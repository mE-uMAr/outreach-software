import clsx from 'clsx'
import { LayoutDashboard, Settings } from 'lucide-react'

export type Route = 'campaigns' | 'settings'

const NAV_ITEMS: { route: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { route: 'campaigns', label: 'Campaigns', icon: LayoutDashboard },
  { route: 'settings', label: 'Settings', icon: Settings }
]

interface TopNavProps {
  route: Route
  onNavigate: (route: Route) => void
}

export function TopNav({ route, onNavigate }: TopNavProps): JSX.Element {
  return (
    <header className="sticky top-0 z-[200] flex h-[54px] shrink-0 items-center justify-between border-b border-line bg-white px-8 shadow-topbar">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-extrabold text-white">
          Li
        </span>
        <span className="text-sm font-bold text-ink">LinkedIn Outreach</span>
      </div>

      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = route === item.route
          return (
            <button
              key={item.route}
              onClick={() => onNavigate(item.route)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'focus-ring flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] transition-colors',
                active
                  ? 'bg-brand-50 font-semibold text-brand-500'
                  : 'font-medium text-ink-muted hover:bg-canvas hover:text-ink'
              )}
            >
              <Icon size={15} strokeWidth={2} />
              {item.label}
            </button>
          )
        })}
      </nav>

      <button
        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white"
        aria-label="Account — Aisha"
        title="Aisha"
      >
        A
      </button>
    </header>
  )
}
