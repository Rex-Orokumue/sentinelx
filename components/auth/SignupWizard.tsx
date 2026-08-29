'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Check, X, Loader2, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { signup, resendConfirmation, type ActionState } from '@/lib/auth/actions'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GoogleSignInButton } from './GoogleSignInButton'

function Dots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-6 flex justify-center gap-2">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`h-1.5 w-8 rounded-full ${n <= step ? 'bg-violet-500' : 'bg-slate-700'}`} />
      ))}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Creating account…' : 'Create account'}
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
      {pending ? 'Sending…' : "Resend it"}
    </button>
  )
}

export function SignupWizard({ refCode }: { refCode: string | null }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [state, formAction] = useFormState<ActionState, FormData>(signup, undefined)
  const [resendState, resendAction] = useFormState<ActionState, FormData>(resendConfirmation, undefined)
  const availability = useUsernameAvailability(username)

  useEffect(() => {
    if (state?.success === 'check-email') setStep(3)
  }, [state])

  if (step === 3) {
    return (
      <div className="text-center">
        <Dots step={3} />
        <h1 className="mb-2 text-xl font-bold">Check your email</h1>
        <p className="text-sm text-slate-400">
          We sent a confirmation link to <span className="font-semibold text-white">{email}</span>. Click it to
          activate your account, then log in and pick your handle.
        </p>
        <div className="mt-5 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
          {resendState?.success ? (
            <p className="text-emerald-400">{resendState.success}</p>
          ) : (
            <>
              <p className="mb-2">Nothing after a few minutes? Check your spam folder, then:</p>
              <form action={resendAction}>
                <input type="hidden" name="email" value={email} />
                <ResendButton />
              </form>
              {resendState?.error && <p className="mt-1 text-red-400">{resendState.error}</p>}
            </>
          )}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Email links sometimes get held up. Signing up with Google skips confirmation entirely —{' '}
          <Link href="/signup" className="text-violet-400 hover:text-violet-300">start over</Link> and use the
          Google button.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction}>
      <Dots step={step} />
      {/* Single source of truth for the submitted username */}
      <input type="hidden" name="username" value={username} />
      {refCode && <input type="hidden" name="ref" value={refCode} />}

      {/* Step 1 — username only */}
      <div className={step === 1 ? 'block' : 'hidden'}>
        <h1 className="mb-1 text-xl font-bold">Join SentinelX Esports</h1>
        <p className="mb-4 text-sm text-slate-400">Fastest way in — no email confirmation needed:</p>
        <GoogleSignInButton next="/dashboard" />
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="text-xs text-slate-500">OR SIGN UP WITH EMAIL</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="username-input">Username</Label>
          <div className="relative">
            <Input
              id="username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {availability === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              {availability === 'available' && <Check className="h-4 w-4 text-green-500" />}
              {(availability === 'taken' || availability === 'invalid') && <X className="h-4 w-4 text-red-500" />}
              {availability === 'unknown' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
            </span>
          </div>
          {availability === 'taken' && <p className="text-sm text-red-400">That username is taken.</p>}
          {availability === 'invalid' && (
            <p className="text-sm text-red-400">3–20 characters: letters, numbers, underscores.</p>
          )}
          {availability === 'unknown' && (
            <p className="text-sm text-amber-400">Couldn&apos;t verify right now — you can still continue.</p>
          )}
        </div>
        <Button
          type="button"
          className="mt-4 w-full"
          variant="outline"
          disabled={availability !== 'available' && availability !== 'unknown'}
          onClick={() => setStep(2)}
        >
          Continue with email
        </Button>
        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="text-violet-400 hover:text-violet-300">Log in</Link>
        </p>
      </div>

      {/* Step 2 — email + password */}
      <div className={step === 2 ? 'block' : 'hidden'}>
        <h1 className="mb-1 text-xl font-bold">Create your account</h1>
        <p className="mb-6 text-sm text-slate-400">
          Signing up as <span className="font-semibold text-white">{username}</span>.
        </p>
        <div className="space-y-4">
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
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500">At least 8 characters.</p>
          </div>
        </div>
        {state?.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
          <div className="flex-1"><SubmitButton /></div>
        </div>
      </div>
    </form>
  )
}
