'use client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Submit button for a `<form action={...}>` driven by `useFormState`.
 * Disables itself and swaps its label while the action is in flight, so a
 * slow server action (e.g. confirming a match result) can't be double-tapped
 * into firing twice. Must be rendered as a child of the `<form>` it submits —
 * `useFormStatus` reads pending state from the nearest form ancestor.
 *
 * Extra button props (e.g. `name`/`value` to distinguish which submit button
 * a multi-action form was submitted with) pass through untouched.
 */
export function SubmitButton({
  pendingLabel,
  className,
  children,
  ...rest
}: {
  pendingLabel: string
  className: string
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'className' | 'children'>) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
      {...rest}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
