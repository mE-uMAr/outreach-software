import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** Required: the button has no visible text, so it needs an accessible name. */
  label: string
}

/** Square bordered action button used in table rows and toolbars. */
export function IconButton({ icon, label, className, ...props }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={clsx(
        'focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white',
        'text-ink-muted transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-ink',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    >
      {icon}
    </button>
  )
}
