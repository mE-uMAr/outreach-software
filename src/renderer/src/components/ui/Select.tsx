import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

interface SelectProps<T extends string> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** Accessible name for the control. */
  label: string
  className?: string
  disabled?: boolean
  placeholder?: string
}

interface PopoverRect {
  top: number
  left: number
  width: number
  /** Set when the list is flipped above the trigger. */
  above: boolean
}

const MAX_POPOVER_HEIGHT = 280

/**
 * Dropdown built entirely in the DOM.
 *
 * A native `<select>` delegates its popup to the OS, which does not render
 * reliably under Electron on Wayland — the list opens but is never painted. This
 * draws the list itself, so behaviour is identical on every platform, and it can
 * be styled to match the design.
 *
 * The list renders in a portal with fixed positioning: several call sites live
 * inside `overflow-hidden` cards that would otherwise clip it.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  disabled,
  placeholder = 'Select…'
}: SelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<PopoverRect | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const position = useCallback((): void => {
    const trigger = triggerRef.current
    if (!trigger) return

    const bounds = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - bounds.bottom
    const above = spaceBelow < Math.min(MAX_POPOVER_HEIGHT, options.length * 36 + 8) && bounds.top > spaceBelow

    setRect({
      top: above ? bounds.top - 6 : bounds.bottom + 6,
      left: bounds.left,
      width: bounds.width,
      above
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) return
    position()
  }, [open, position])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }

    // Reposition rather than close: the settings panel scrolls under the list.
    const onReflow = (): void => position()

    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [open, position])

  const commit = (option: SelectOption<T>): void => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const openList = (): void => {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (disabled) return

    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (options[activeIndex]) commit(options[activeIndex])
        break
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => Math.min(options.length - 1, index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => Math.max(0, index - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div className={clsx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={clsx(
          'flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-[9px] text-left text-[13px] text-ink',
          'outline-none transition-[border-color,box-shadow]',
          open ? 'border-brand-500 shadow-[0_0_0_3px_rgba(37,99,235,0.125)]' : 'border-line',
          disabled
            ? 'cursor-not-allowed bg-canvas text-ink-subtle'
            : 'cursor-pointer hover:border-slate-300'
        )}
      >
        <span className={clsx('truncate', !selected && 'text-ink-subtle')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={clsx(
            'shrink-0 text-ink-subtle transition-transform',
            open && 'rotate-180',
            disabled && 'opacity-50'
          )}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={label}
            style={{
              position: 'fixed',
              top: rect.above ? undefined : rect.top,
              bottom: rect.above ? window.innerHeight - rect.top : undefined,
              left: rect.left,
              width: rect.width,
              maxHeight: MAX_POPOVER_HEIGHT
            }}
            className="z-[500] animate-fadeIn overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-pop"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option)}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                    'disabled:pointer-events-none disabled:opacity-40',
                    index === activeIndex ? 'bg-brand-50 text-brand-500' : 'text-ink',
                    isSelected && index !== activeIndex && 'font-medium'
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <Check size={13} strokeWidth={2.6} className="shrink-0 text-brand-500" />
                  )}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}
