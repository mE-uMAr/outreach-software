import clsx from 'clsx'
import { Info } from 'lucide-react'
import { forwardRef } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/** Shared control styling (design: `.field-input`). */
export const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-[9px] text-[13px] text-ink outline-none transition-[border-color,box-shadow] ' +
  'focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.125)] ' +
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-subtle'

/** Hover tooltip used next to field labels. */
export function Tooltip({ text }: { text: string }): JSX.Element {
  return (
    <span className="group/tip relative inline-flex">
      <Info size={13} strokeWidth={2} className="cursor-help text-ink-subtle" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-[9px] py-[5px] text-[11px] text-white opacity-0 transition-opacity group-hover/tip:opacity-100"
      >
        {text}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
      </span>
    </span>
  )
}

interface FieldLabelProps {
  children: ReactNode
  icon?: ReactNode
  hint?: string
  optional?: boolean
  className?: string
}

export function FieldLabel({
  children,
  icon,
  hint,
  optional,
  className
}: FieldLabelProps): JSX.Element {
  return (
    <label
      className={clsx('mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink', className)}
    >
      {icon && <span className="text-ink-muted">{icon}</span>}
      {children}
      {optional && <span className="text-[11px] font-normal text-ink-subtle">(optional)</span>}
      {hint && <Tooltip text={hint} />}
    </label>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input className={clsx(fieldClass, 'w-full', className)} {...props} />
}

/** Forwards its ref so callers can read the caret position. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx(fieldClass, 'w-full resize-y leading-[1.7]', className)}
        {...props}
      />
    )
  }
)

/**
 * Native select with the design's inline chevron. Kept native so keyboard and
 * screen-reader behaviour is unchanged.
 */
export function FieldSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select
      className={clsx(
        fieldClass,
        'w-full cursor-pointer appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-7',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")]",
        'disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  suffix?: string
  disabled?: boolean
  ariaLabel: string
}

export function NumberField({
  value,
  onChange,
  min = 1,
  max = 100,
  suffix,
  disabled,
  ariaLabel
}: NumberFieldProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value)
          // An empty input parses to 0; clamp instead of writing NaN/0 into state.
          onChange(Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : min)
        }}
        className={clsx(fieldClass, 'w-[90px]')}
      />
      {suffix && <span className="whitespace-nowrap text-xs text-ink-muted">{suffix}</span>}
    </div>
  )
}

/** Blue advisory strip used under the schedule and limits sections. */
export function InfoBanner({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-brand-500/20 bg-brand-50 px-3.5 py-2.5">
      <Info size={14} strokeWidth={2} className="mt-px shrink-0 text-brand-500" />
      <p className="text-xs leading-relaxed text-brand-500">{children}</p>
    </div>
  )
}

/** Thin meter under limit inputs (design: `.char-bar`). */
export function MeterBar({
  percent,
  tone = 'success',
  className
}: {
  percent: number
  tone?: 'success' | 'warn' | 'danger' | 'brand'
  className?: string
}): JSX.Element {
  const colors = {
    success: 'bg-success',
    warn: 'bg-warn',
    danger: 'bg-danger',
    brand: 'bg-brand-500'
  }
  return (
    <div className={clsx('h-[3px] overflow-hidden rounded-full bg-line', className)}>
      <div
        className={clsx('h-full rounded-full transition-[width,background-color]', colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  )
}
