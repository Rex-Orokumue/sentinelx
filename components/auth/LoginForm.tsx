'use client'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { login, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Log in'}
    </Button>
  )
}

export function LoginForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(login, undefined)
  const next = useSearchParams().get('next') ?? '/dashboard'
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
      <div className="flex justify-between text-sm text-slate-400">
        <Link href="/forgot-password" className="hover:text-white">Forgot password?</Link>
        <Link href="/signup" className="hover:text-white">Create account</Link>
      </div>
    </form>
  )
}
