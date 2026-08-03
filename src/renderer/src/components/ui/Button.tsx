import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Rendered before the label at a size matched to the button. */
  icon?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  // Disabled primary is a flat grey in the design, not a faded blue.
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 hover:-translate-y-px hover:shadow-button active:translate-y-0 ' +
    'disabled:bg-slate-300 disabled:text-slate-400 disabled:opacity-100 disabled:shadow-none disabled:translate-y-0',
  secondary: 'bg-white text-ink border border-line hover:bg-slate-50 active:bg-slate-100',
  ghost: 'bg-transparent text-ink-muted hover:bg-slate-100 hover:text-ink',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50'
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      className={clsx(
        'focus-ring inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
