import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
}

interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  label: string
}

/**
 * Native select with the platform chrome removed and a lucide chevron drawn on
 * top — the design's dropdowns rendered as raw OS controls. Keeping the native
 * element preserves keyboard and screen-reader behaviour.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  ...props
}: SelectProps<T>): JSX.Element {
  return (
    <div className={clsx('relative', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={clsx(
          'focus-ring h-10 w-full cursor-pointer appearance-none rounded-lg border border-line bg-white',
          'pl-3 pr-9 text-sm font-medium text-ink transition-colors hover:border-slate-300'
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  )
}
