import clsx from 'clsx'
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
  /** Blocks Escape and the close button while a job is in flight. */
  dismissable?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = 'max-w-[720px]',
  dismissable = true
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissable) onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Move focus into the dialog so keyboard users are not left behind it.
    panelRef.current?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose, dismissable])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[400] flex animate-overlayIn items-center justify-center bg-slate-900/40 p-6 backdrop-blur-[6px]"
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'flex max-h-full w-full animate-modalIn flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none',
          width
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-ink">{title}</h2>
              {subtitle && <p className="truncate text-[13px] text-ink-muted">{subtitle}</p>}
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={!dismissable}
            aria-label="Close dialog"
            className="focus-ring -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-slate-100 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-line bg-canvas px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}
