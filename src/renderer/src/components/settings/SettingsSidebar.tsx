import clsx from 'clsx'
import {
  Activity,
  Calendar,
  Clock,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  Sheet,
  type LucideIcon
} from 'lucide-react'

export interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 's-schedule', label: 'Weekly Schedule', icon: Calendar },
  { id: 's-limits', label: 'Activity Limits', icon: Activity },
  { id: 's-followup', label: 'Follow-up Rules', icon: Clock },
  { id: 's-templates', label: 'Message Templates', icon: MessageSquare },
  { id: 's-sheets', label: 'Sheets Integration', icon: Sheet },
  { id: 's-ai', label: 'AI Connection', icon: Plug }
]

interface SettingsSidebarProps {
  activeId: string
  onSelect: (id: string) => void
  onBackToDashboard: () => void
}

export function SettingsSidebar({
  activeId,
  onSelect,
  onBackToDashboard
}: SettingsSidebarProps): JSX.Element {
  const item =
    'flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left text-[13px] font-medium transition-colors'

  return (
    <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-white px-3 py-6">
      <div className="mb-4 flex items-center gap-2 px-3">
        <Settings size={14} strokeWidth={2} className="text-ink-subtle" />
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
          Settings
        </span>
      </div>

      <nav className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon
          const active = activeId === section.id
          return (
            <button
              key={section.id}
              onClick={() => onSelect(section.id)}
              aria-current={active ? 'true' : undefined}
              className={clsx(
                item,
                active ? 'bg-brand-50 text-brand-500' : 'text-ink-muted hover:bg-canvas hover:text-ink'
              )}
            >
              <Icon size={15} strokeWidth={2} />
              {section.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-4 px-3">
        <div className="mb-3 h-px bg-line" />
        <button
          onClick={onBackToDashboard}
          className={clsx(item, 'font-semibold text-brand-500 hover:bg-canvas')}
        >
          <LayoutDashboard size={15} strokeWidth={2} />
          ← Back to Dashboard
        </button>
      </div>
    </aside>
  )
}
