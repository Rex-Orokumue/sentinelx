'use client'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { requestReset, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Sending…' : 'Send reset link'}
    </Button>
  )
}

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(requestReset, undefined)
  if (state?.success) {
    return (
      <div>
        <p className="text-sm text-slate-300">{state.success}</p>
        <p className="mt-4 text-center text-sm text-slate-400">
          <Link href="/login" className="hover:text-white">Back to log in</Link>
        </p>
      </div>
    )
  }
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
      <p className="text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-white">Back to log in</Link>
      </p>
    </form>
  )
}
