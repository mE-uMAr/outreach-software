import clsx from 'clsx'
import { ArrowLeft, ArrowRight } from 'lucide-react'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps): JSX.Element {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  const step =
    'focus-ring inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-white px-3 text-[13px] font-medium text-ink transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="text-[13px] text-ink-muted">
        Showing <span className="font-semibold text-ink">{first}</span>–
        <span className="font-semibold text-ink">{last}</span> of{' '}
        <span className="font-semibold text-ink">{total}</span>
      </p>

      <div className="flex items-center gap-1.5">
        <button className={step} onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ArrowLeft size={14} strokeWidth={2.2} />
          Prev
        </button>

        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
          <button
            key={number}
            onClick={() => onPageChange(number)}
            aria-current={number === page ? 'page' : undefined}
            className={clsx(
              'focus-ring h-9 min-w-9 rounded-lg px-3 text-[13px] font-semibold transition-colors',
              number === page
                ? 'bg-brand-600 text-white'
                : 'border border-line bg-white text-ink hover:bg-slate-50'
            )}
          >
            {number}
          </button>
        ))}

        <button
          className={step}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
        >
          Next
          <ArrowRight size={14} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
