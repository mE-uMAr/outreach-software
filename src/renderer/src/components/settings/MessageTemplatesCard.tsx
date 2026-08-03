import clsx from 'clsx'
import { useRef, useState } from 'react'
import {
  Briefcase,
  Building2,
  ChevronDown,
  ChevronUp,
  Eye,
  MessageSquare,
  User,
  type LucideIcon
} from 'lucide-react'
import { SectionCard } from './SectionCard.js'
import { Button } from '../ui/Button.js'
import { FieldLabel, MeterBar, TextArea, TextInput } from '../ui/Field.js'
import { isTemplateComplete, type MessageTemplate, type TemplateId } from '../../data/types.js'

const TEMPLATE_ICONS: Record<TemplateId, { icon: LucideIcon; className: string }> = {
  'connection-note': { icon: User, className: 'text-accent' },
  'first-message': { icon: MessageSquare, className: 'text-success' },
  'second-followup': { icon: MessageSquare, className: 'text-warn' },
  'third-followup': { icon: MessageSquare, className: 'text-danger' }
}

const VARIABLES: { token: string; icon: LucideIcon }[] = [
  { token: '{{FirstName}}', icon: User },
  { token: '{{LastName}}', icon: User },
  { token: '{{Company}}', icon: Building2 },
  { token: '{{JobTitle}}', icon: Briefcase }
]

const SAMPLE = {
  '{{FirstName}}': 'Amara',
  '{{LastName}}': 'Okafor',
  '{{Company}}': 'Northwind Labs',
  '{{JobTitle}}': 'VP of Growth'
} as const

function fillVariables(body: string): string {
  return Object.entries(SAMPLE).reduce(
    (text, [token, value]) => text.split(token).join(value),
    body
  )
}

interface MessageTemplatesCardProps {
  templates: MessageTemplate[]
  onChange: (templates: MessageTemplate[]) => void
}

export function MessageTemplatesCard({
  templates,
  onChange
}: MessageTemplatesCardProps): JSX.Element {
  const [openId, setOpenId] = useState<TemplateId | null>('connection-note')
  const [previewId, setPreviewId] = useState<TemplateId | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const patch = (id: TemplateId, changes: Partial<MessageTemplate>): void => {
    onChange(templates.map((template) => (template.id === id ? { ...template, ...changes } : template)))
  }

  /** Insert at the caret so a variable lands where the user is typing. */
  const insertVariable = (template: MessageTemplate, token: string): void => {
    const field = bodyRef.current
    const start = field?.selectionStart ?? template.body.length
    const end = field?.selectionEnd ?? template.body.length
    const next = template.body.slice(0, start) + token + template.body.slice(end)

    if (next.length > template.maxChars) return
    patch(template.id, { body: next })

    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <SectionCard
      id="s-templates"
      icon={MessageSquare}
      tone="accent"
      title="Message Templates"
      description="Configure personalized outreach and follow-up messages using dynamic variables."
      delayMs={200}
      bare
    >
      {templates.map((template) => {
        const open = openId === template.id
        const complete = isTemplateComplete(template)
        const { icon: Icon, className } = TEMPLATE_ICONS[template.id]
        const used = template.body.length
        const percent = (used / template.maxChars) * 100

        return (
          <div key={template.id} className="border-t border-line">
            <button
              onClick={() => setOpenId(open ? null : template.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-canvas"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-canvas">
                  <Icon size={14} strokeWidth={2} className={className} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-ink">{template.title}</div>
                  <p className="truncate text-xs text-ink-subtle">{template.description}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={clsx(
                    'text-[11px] font-medium',
                    complete ? 'text-success' : 'text-warn'
                  )}
                >
                  {complete ? 'Ready' : 'Incomplete'}
                </span>
                {open ? (
                  <ChevronUp size={16} strokeWidth={2} className="text-ink-subtle" />
                ) : (
                  <ChevronDown size={16} strokeWidth={2} className="text-ink-subtle" />
                )}
              </div>
            </button>

            {open && (
              <div className="animate-fadeIn border-t border-line px-7 pb-4 pt-1">
                <div className="mb-3.5">
                  <FieldLabel optional hint="Optional subject line for InMail messages">
                    Subject
                  </FieldLabel>
                  <TextInput
                    value={template.subject}
                    placeholder="e.g. Quick question about your growth work"
                    onChange={(event) => patch(template.id, { subject: event.target.value })}
                  />
                </div>

                <div className="mb-2.5">
                  <p className="mb-[7px] text-xs font-medium text-ink-muted">Insert variable:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {VARIABLES.map((variable) => {
                      const VarIcon = variable.icon
                      return (
                        <button
                          key={variable.token}
                          onClick={() => insertVariable(template, variable.token)}
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1 font-mono text-xs font-medium text-ink-muted transition-colors hover:border-brand-500/30 hover:bg-brand-50 hover:text-brand-500"
                        >
                          <VarIcon size={11} strokeWidth={2} />
                          {variable.token}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="relative">
                  <TextArea
                    ref={bodyRef}
                    rows={6}
                    value={template.body}
                    maxLength={template.maxChars}
                    placeholder="Write your message here. Use variables like {{FirstName}} to personalize."
                    onChange={(event) => patch(template.id, { body: event.target.value })}
                    className="pb-8"
                  />
                  <span
                    className={clsx(
                      'pointer-events-none absolute bottom-2.5 right-3 text-[11px] font-semibold',
                      percent > 90 ? 'text-warn' : 'text-ink-subtle'
                    )}
                  >
                    {used} / {template.maxChars}
                  </span>
                </div>

                <MeterBar
                  percent={percent}
                  tone={percent > 90 ? 'warn' : 'brand'}
                  className="mt-1.5"
                />

                <Button
                  size="sm"
                  className="mt-3 text-xs"
                  icon={<Eye size={13} strokeWidth={2} />}
                  onClick={() => setPreviewId(previewId === template.id ? null : template.id)}
                >
                  {previewId === template.id ? 'Hide preview' : 'Preview personalized message'}
                </Button>

                {previewId === template.id && (
                  <div className="mt-3 max-w-[480px] animate-fadeIn whitespace-pre-wrap rounded-xl rounded-bl-[4px] bg-slate-100 px-4 py-3.5 text-[13px] leading-[1.7] text-ink">
                    {template.body.trim()
                      ? fillVariables(template.body)
                      : 'Nothing to preview yet — write a message above.'}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </SectionCard>
  )
}
