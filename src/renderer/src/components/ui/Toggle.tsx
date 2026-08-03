import clsx from 'clsx'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name — the switch has no visible text of its own. */
  label: string
  disabled?: boolean
}

/** 44×24 switch matching the design's `.toggle-track` / `.toggle-thumb`. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand-500' : 'bg-slate-300',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={clsx(
          'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-[left]',
          checked ? 'left-[23px]' : 'left-[3px]'
        )}
      />
    </button>
  )
}

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description?: string
}

/** Boxed checkbox row used by the follow-up withdraw option. */
export function CheckboxRow({ checked, onChange, title, description }: CheckboxProps): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-canvas px-4 py-3.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={clsx(
          'mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/60 peer-focus-visible:ring-offset-1',
          checked ? 'border-brand-500 bg-brand-500' : 'border-slate-300 bg-white'
        )}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>
        )}
      </span>
    </label>
  )
}
