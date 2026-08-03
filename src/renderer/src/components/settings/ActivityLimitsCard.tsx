import { Activity, Hash, MessageSquare, User, type LucideIcon } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { FieldLabel, InfoBanner, MeterBar, NumberField } from '../ui/Field.js'
import type { ActivityLimits } from '../../data/types.js'

interface LimitDefinition {
  key: keyof ActivityLimits
  label: string
  icon: LucideIcon
  max: number
  recommended: number
}

const LIMITS: LimitDefinition[] = [
  { key: 'connectionRequests', label: 'Connection Requests', icon: User, max: 50, recommended: 25 },
  { key: 'postLikes', label: 'Post Likes', icon: Hash, max: 80, recommended: 40 },
  { key: 'postComments', label: 'Post Comments', icon: MessageSquare, max: 40, recommended: 20 }
]

/** Above the recommended value the meter turns amber, then red near the cap. */
function toneFor(value: number, recommended: number, max: number): 'success' | 'warn' | 'danger' {
  if (value > max * 0.9) return 'danger'
  if (value > recommended) return 'warn'
  return 'success'
}

function captionFor(value: number, recommended: number, max: number): string {
  const tone = toneFor(value, recommended, max)
  if (tone === 'danger') return `High risk — recommended: ${recommended}`
  if (tone === 'warn') return `Above recommended: ${recommended}`
  return `Safe — recommended: ${recommended}`
}

interface ActivityLimitsCardProps {
  limits: ActivityLimits
  onChange: (limits: ActivityLimits) => void
}

export function ActivityLimitsCard({ limits, onChange }: ActivityLimitsCardProps): JSX.Element {
  return (
    <SectionCard
      id="s-limits"
      icon={Activity}
      tone="success"
      title="Daily Activity Limits"
      description="Set hard caps on daily automation actions to protect your account."
      delayMs={100}
    >
      <div className="grid gap-5 md:grid-cols-3">
        {LIMITS.map((definition) => {
          const Icon = definition.icon
          const value = limits[definition.key]
          const tone = toneFor(value, definition.recommended, definition.max)

          return (
            <div
              key={definition.key}
              className="rounded-[10px] border border-line bg-canvas px-[18px] py-4"
            >
              <FieldLabel icon={<Icon size={15} strokeWidth={2} />} hint="Max per day">
                {definition.label}
              </FieldLabel>

              <NumberField
                ariaLabel={definition.label}
                value={value}
                min={1}
                max={definition.max}
                onChange={(next) => onChange({ ...limits, [definition.key]: next })}
              />

              <div className="mt-2.5">
                <MeterBar percent={(value / definition.max) * 100} tone={tone} />
                <p className="mt-[5px] text-[11px] text-ink-subtle">
                  {captionFor(value, definition.recommended, definition.max)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <InfoBanner>
        Recommended LinkedIn safety limits help reduce the risk of account restrictions.
      </InfoBanner>
    </SectionCard>
  )
}
