import { Bot, Eye, EyeOff, Gauge, Zap } from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { FieldLabel } from '../ui/Field.js'
import { Select } from '../ui/Select.js'
import { Toggle } from '../ui/Toggle.js'
import type { BrowserSettings } from '../../data/types.js'

interface BrowserAutomationCardProps {
  settings: BrowserSettings
  onChange: (settings: BrowserSettings) => void
}

/** The CLI takes these aliases and maps them to the current model in each family. */
const FAST_MODELS = [
  { value: 'haiku', label: 'Haiku — fastest, cheapest' },
  { value: 'sonnet', label: 'Sonnet — balanced' }
]

const REASONING_MODELS = [
  { value: 'sonnet', label: 'Sonnet — balanced' },
  { value: 'opus', label: 'Opus — highest quality' }
]

const STEP_LIMITS = [6, 8, 12, 16, 24].map((value) => ({
  value: String(value),
  label: `${value} steps`
}))

/**
 * How the automation is allowed to spend time and money.
 *
 * These are the two levers that actually move the bill: whether a page the agent
 * has already solved is re-solved, and which model gets asked. Both are shown
 * with what they cost so the tradeoff is a decision rather than a guess.
 */
export function BrowserAutomationCard({
  settings,
  onChange
}: BrowserAutomationCardProps): JSX.Element {
  const patch = (changes: Partial<BrowserSettings>): void => onChange({ ...settings, ...changes })

  return (
    <SectionCard
      id="s-browser"
      icon={Bot}
      tone="success"
      title="Browser Automation"
      description="How the agent reads LinkedIn pages and decides what to click."
      delayMs={320}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <Row
            icon={Zap}
            title="Remember page layouts"
            detail="Replays the action that worked last time instead of asking Claude again. This is where nearly all of the saving comes from — turn it off only while debugging a LinkedIn redesign."
          >
            <Toggle
              checked={settings.planCache}
              onChange={(planCache) => patch({ planCache })}
              label="Remember page layouts"
            />
          </Row>

          <Row
            icon={settings.headless ? EyeOff : Eye}
            title={settings.headless ? 'Run hidden' : 'Show the browser'}
            detail={
              settings.headless
                ? 'Faster and out of the way, but a hidden browser is easier for LinkedIn to spot.'
                : 'A visible window is the safer choice for account health, and lets you watch what the agent does.'
            }
          >
            <Toggle
              checked={settings.headless}
              onChange={(headless) => patch({ headless })}
              label="Run the browser hidden"
            />
          </Row>

          <Row
            icon={Gauge}
            title="Step limit per task"
            detail="How many actions the agent may take before giving up on one page. A stuck page costs a model call per step."
          >
            <Select
              label="Maximum steps per task"
              value={String(settings.maxStepsPerTask)}
              options={STEP_LIMITS}
              onChange={(value) => patch({ maxStepsPerTask: Number(value) })}
            />
          </Row>
        </div>

        <div className="flex flex-col rounded-[10px] border border-line bg-canvas px-[18px] py-4">
          <FieldLabel hint="Chooses what to click, on most pages">Everyday decisions</FieldLabel>
          <Select
            label="Fast model"
            value={settings.fastModel}
            options={FAST_MODELS}
            onChange={(fastModel) => patch({ fastModel })}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
            &ldquo;Which of these controls do I click&rdquo; is not hard reasoning, and it is the
            question asked most often.
          </p>

          <div className="mt-4">
            <FieldLabel hint="Used after a step has failed, and for planning">
              Harder decisions
            </FieldLabel>
            <Select
              label="Reasoning model"
              value={settings.reasoningModel}
              options={REASONING_MODELS}
              onChange={(reasoningModel) => patch({ reasoningModel })}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
              Reached for only when the fast model has already been wrong, and for campaign
              planning and message drafting.
            </p>
          </div>

          <div className="mt-auto rounded-lg border border-line bg-white px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Pages are read as an accessibility outline first — about a tenth the cost of a
              screenshot. An image is attached only after a step has actually failed.
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function Row({
  icon: Icon,
  title,
  detail,
  children
}: {
  icon: typeof Zap
  title: string
  detail: string
  children: JSX.Element
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
        <Icon size={15} strokeWidth={2.1} className="text-ink-subtle" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">{detail}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
