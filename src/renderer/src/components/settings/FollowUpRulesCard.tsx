import clsx from 'clsx'
import { Check, Clock } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { CheckboxRow } from '../ui/Toggle.js'
import { FieldLabel, NumberField } from '../ui/Field.js'
import type { FollowUpRules } from '../../data/types.js'

interface StageProps {
  tone: 'success' | 'brand' | 'accent'
  content: React.ReactNode
  label: string
}

const STAGE_TONES = {
  success: 'border-success text-success bg-success/[0.125]',
  brand: 'border-brand-500 text-brand-500 bg-brand-500/[0.125]',
  accent: 'border-accent text-accent bg-accent/[0.125]'
} as const

function Stage({ tone, content, label }: StageProps): JSX.Element {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div
        className={clsx(
          'flex h-9 w-9 items-center justify-center rounded-full border-2 text-[13px] font-bold',
          STAGE_TONES[tone]
        )}
      >
        {content}
      </div>
      <p className="whitespace-pre-line text-center text-[10px] font-semibold leading-[1.4] text-ink-muted">
        {label}
      </p>
    </div>
  )
}

function Connector({ days }: { days: number }): JSX.Element {
  return (
    <div className="flex min-w-[70px] flex-1 items-center">
      <div className="h-0.5 flex-1 bg-brand-500/20" />
      <span className="whitespace-nowrap rounded border border-brand-500/20 bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-500">
        +{days}d
      </span>
      <div className="h-0.5 flex-1 bg-brand-500/20" />
    </div>
  )
}

interface FollowUpRulesCardProps {
  rules: FollowUpRules
  onChange: (rules: FollowUpRules) => void
}

export function FollowUpRulesCard({ rules, onChange }: FollowUpRulesCardProps): JSX.Element {
  return (
    <SectionCard
      id="s-followup"
      icon={Clock}
      tone="warn"
      title="Follow-up Rules"
      description="Define when automated follow-up messages are sent after each stage."
      delayMs={150}
    >
      <div className="mb-7 flex items-center overflow-x-auto rounded-[10px] border border-line bg-canvas px-5 py-4">
        <Stage
          tone="success"
          content={<Check size={15} strokeWidth={3} />}
          label={'Connection\nAccepted'}
        />
        <Connector days={rules.secondFollowUpDays} />
        <Stage tone="brand" content="2" label={'Second\nFollow-up'} />
        <Connector days={rules.thirdFollowUpDays} />
        <Stage tone="accent" content="3" label={'Third\nFollow-up'} />
      </div>

      <div className="mb-5 grid gap-5 sm:grid-cols-2">
        <div>
          <FieldLabel hint="Days after acceptance before second follow-up">
            Days before second follow-up
          </FieldLabel>
          <NumberField
            ariaLabel="Days before second follow-up"
            value={rules.secondFollowUpDays}
            min={1}
            max={30}
            suffix="days"
            onChange={(secondFollowUpDays) => onChange({ ...rules, secondFollowUpDays })}
          />
          <p className="mt-[5px] text-[11px] text-ink-subtle">
            Sent after connection acceptance. Minimum 1 day.
          </p>
        </div>

        <div>
          <FieldLabel hint="Days after second follow-up before third">
            Days before third follow-up
          </FieldLabel>
          <NumberField
            ariaLabel="Days before third follow-up"
            value={rules.thirdFollowUpDays}
            min={1}
            max={30}
            suffix="days"
            onChange={(thirdFollowUpDays) => onChange({ ...rules, thirdFollowUpDays })}
          />
          <p className="mt-[5px] text-[11px] text-ink-subtle">
            Sent after the second follow-up. Minimum 1 day.
          </p>
        </div>
      </div>

      <CheckboxRow
        checked={rules.autoWithdrawPending}
        onChange={(autoWithdrawPending) => onChange({ ...rules, autoWithdrawPending })}
        title="Automatically withdraw pending connection requests during follow-up review"
        description="Pending requests older than 21 days are withdrawn before the follow-up day runs, keeping your queue clean."
      />
    </SectionCard>
  )
}
