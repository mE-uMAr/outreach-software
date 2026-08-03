import clsx from 'clsx'
import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ className, children, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={clsx('rounded-card border border-line bg-white shadow-card', className)}
      {...props}
    >
      {children}
    </div>
  )
}
