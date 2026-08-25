import clsx from 'clsx'
import { LayoutDashboard, Settings } from 'lucide-react'
import type { LinkedInAccount } from '../../data/types.js'

export type Route = 'campaigns' | 'settings'

const NAV_ITEMS: { route: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { route: 'campaigns', label: 'Campaigns', icon: LayoutDashboard },
  { route: 'settings', label: 'Settings', icon: Settings }
]

interface TopNavProps {
  route: Route
  onNavigate: (route: Route) => void
  /** The LinkedIn identity the app is acting as. */
  account: LinkedInAccount | null
}

/** Initials for the avatar fallback, from however many names there are. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function TopNav({ route, onNavigate, account }: TopNavProps): JSX.Element {
  const name = account?.fullName || 'Not connected'

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
        onClick={() => onNavigate('settings')}
        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white"
        aria-label={`Signed in as ${name}`}
        title={account?.headline ? `${name} — ${account.headline}` : name}
      >
        {account?.avatarUrl ? (
          <img src={account.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(name)
        )}
      </button>
    </header>
  )
}
