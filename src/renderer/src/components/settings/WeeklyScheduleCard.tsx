import clsx from 'clsx'
import { Calendar } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Toggle } from '../ui/Toggle.js'
import { FieldSelect, InfoBanner, NumberField } from '../ui/Field.js'
import {
  activeDays,
  weeklyTotal,
  type AutomationAction,
  type DaySchedule
} from '../../data/types.js'

const ACTIONS: { value: AutomationAction; label: string }[] = [
  { value: 'send', label: 'Send Connection Requests' },
  { value: 'followup', label: 'Follow-up Requests' },
  { value: 'none', label: 'No Automation' }
]

/** Shared grid so the header labels line up with every row. */
const ROW_GRID = 'grid grid-cols-[48px_100px_minmax(0,1fr)_auto] items-center gap-4'

interface WeeklyScheduleCardProps {
  schedule: DaySchedule[]
  onChange: (schedule: DaySchedule[]) => void
}

export function WeeklyScheduleCard({ schedule, onChange }: WeeklyScheduleCardProps): JSX.Element {
  const patch = (key: DaySchedule['key'], changes: Partial<DaySchedule>): void => {
    onChange(schedule.map((day) => (day.key === key ? { ...day, ...changes } : day)))
  }

  const total = weeklyTotal(schedule)
  const active = activeDays(schedule)

  return (
    <SectionCard
      id="s-schedule"
      icon={Calendar}
      tone="brand"
      title="Weekly Automation Schedule"
      description="Control which days automation runs and what action each day performs."
      delayMs={50}
      aside={
        <div className="flex gap-6">
          <div className="text-center">
            <div className="text-[22px] font-bold leading-tight text-brand-500">{active}</div>
            <div className="text-[11px] text-ink-subtle">Active days</div>
          </div>
          <div className="text-center">
            <div className="text-[22px] font-bold leading-tight text-success">{total}</div>
            <div className="text-[11px] text-ink-subtle">Weekly total</div>
          </div>
        </div>
      }
    >
      <div
        className={clsx(
          ROW_GRID,
          'border-b border-line pb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle'
        )}
      >
        <div />
        <div>Day</div>
        <div>Automation Action</div>
        <div>Daily Limit</div>
      </div>

      {schedule.map((day) => (
        <div key={day.key} className={clsx(ROW_GRID, 'border-b border-line py-3 last:border-b-0')}>
          <Toggle
            checked={day.enabled}
            onChange={(enabled) =>
              patch(day.key, {
                enabled,
                // Turning a day back on should not leave it set to "No Automation".
                action: enabled && day.action === 'none' ? 'send' : day.action,
                dailyLimit: enabled && day.dailyLimit === 0 ? 20 : day.dailyLimit
              })
            }
            label={`${day.enabled ? 'Disable' : 'Enable'} ${day.full}`}
          />

          <div>
            <div
              className={clsx(
                'text-[13px] font-semibold',
                day.enabled ? 'text-ink' : 'text-ink-subtle'
              )}
            >
              {day.short}
            </div>
            <div className="text-[11px] text-ink-subtle">{day.full}</div>
          </div>

          <FieldSelect
            aria-label={`${day.full} automation action`}
            value={day.action}
            disabled={!day.enabled}
            onChange={(event) => patch(day.key, { action: event.target.value as AutomationAction })}
            className="max-w-[260px]"
          >
            {ACTIONS.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </FieldSelect>

          <div className="min-w-[160px]">
            {day.enabled && day.action !== 'none' ? (
              <NumberField
                ariaLabel={`${day.full} daily limit`}
                value={day.dailyLimit}
                min={1}
                max={50}
                suffix="/ day"
                onChange={(dailyLimit) => patch(day.key, { dailyLimit })}
              />
            ) : (
              <span className="text-xs text-ink-subtle">—</span>
            )}
          </div>
        </div>
      ))}

      <InfoBanner>
        LinkedIn recommends staying under <strong className="font-semibold">20–30 requests per day</strong>. Your
        schedule sends <strong className="font-semibold">{total} per week</strong>.
      </InfoBanner>
    </SectionCard>
  )
}
