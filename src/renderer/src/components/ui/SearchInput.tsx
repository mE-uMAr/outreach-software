import clsx from 'clsx'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Search field with a real icon in place of the design's emoji magnifier. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className
}: SearchInputProps): JSX.Element {
  return (
    <div className={clsx('relative', className)}>
      <Search
        size={16}
        strokeWidth={2}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
      />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(
          'focus-ring h-10 w-full rounded-lg border border-line bg-white pl-9 pr-9 text-sm',
          'text-ink transition-colors placeholder:text-ink-subtle hover:border-slate-300'
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="focus-ring absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-slate-100 hover:text-ink"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
