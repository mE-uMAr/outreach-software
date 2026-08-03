import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

interface MenuProps {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
}

/** Popover menu behind the row overflow (…) button. */
export function Menu({ trigger, items, align = 'right' }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {trigger({ onClick: () => setOpen((value) => !value), 'aria-expanded': open })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-30 mt-1.5 min-w-[184px] overflow-hidden rounded-xl border border-line bg-white p-1 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                'disabled:pointer-events-none disabled:opacity-40',
                item.tone === 'danger'
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-ink hover:bg-slate-100'
              )}
            >
              <span className="text-ink-subtle">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
