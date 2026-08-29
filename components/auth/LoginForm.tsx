'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { login, resendConfirmation, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GoogleSignInButton } from './GoogleSignInButton'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Log in'}
    </Button>
  )
}

function ResendButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-60"
    >
      {pending ? 'Sending…' : 'Resend confirmation email'}
    </button>
  )
}

export function LoginForm() {
  const [state, formAction] = useFormState<ActionState, FormData>(login, undefined)
  const [resendState, resendAction] = useFormState<ActionState, FormData>(resendConfirmation, undefined)
  const [email, setEmail] = useState('')
  const next = useSearchParams().get('next') ?? '/dashboard'

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        <SubmitButton />
      </form>

      {state?.needsConfirmation && !resendState?.success && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
          <form action={resendAction}>
            <input type="hidden" name="email" value={email} />
            <ResendButton />
          </form>
          <p className="mt-1 text-xs text-slate-500">
            Didn&apos;t get the first one? Check spam — or use Google sign-in below, which skips email confirmation.
          </p>
        </div>
      )}
      {resendState?.success && <p className="text-sm text-emerald-400">{resendState.success}</p>}
      {resendState?.error && <p className="text-sm text-red-400">{resendState.error}</p>}

      <div className="flex justify-between text-sm text-slate-400">
        <Link href="/forgot-password" className="hover:text-white">Forgot password?</Link>
        <Link href="/signup" className="hover:text-white">Create account</Link>
      </div>
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-slate-800" />
        <span className="text-xs text-slate-500">OR</span>
        <div className="h-px flex-1 bg-slate-800" />
      </div>
      <GoogleSignInButton next={next} />
    </div>
  )
}
