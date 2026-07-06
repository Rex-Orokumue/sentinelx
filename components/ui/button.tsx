'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

const base =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

const variants = {
  default:     'bg-primary text-primary-foreground hover:bg-primary/90',
  outline:     'border border-input bg-background hover:bg-muted hover:text-foreground',
  secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost:       'hover:bg-muted hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  link:        'text-primary underline-offset-4 hover:underline',
} as const

const sizes = {
  default: 'h-9 px-4 py-2',
  sm:      'h-8 rounded-md px-3',
  lg:      'h-10 rounded-md px-8',
  icon:    'h-9 w-9',
} as const

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { Button }
