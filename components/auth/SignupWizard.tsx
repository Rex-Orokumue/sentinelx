'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Check, X, Loader2, Eye, EyeOff } from 'lucide-react'
import { signup, type ActionState } from '@/lib/auth/actions'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

export function SignupWizard({ refCode }: { refCode: string | null }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [username, setUsername] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [state, formAction] = useFormState<ActionState, FormData>(signup, undefined)
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
          We sent a confirmation link to your inbox. Click it to activate your account, then log in.
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
        <h1 className="mb-1 text-xl font-bold">Choose your handle</h1>
        <p className="mb-6 text-sm text-slate-400">This is your public username on SentinelX Esports.</p>
        <div className="space-y-1.5">
          <Label htmlFor="username-input">Username</Label>
          <div className="relative">
            <Input
              id="username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {availability === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              {availability === 'available' && <Check className="h-4 w-4 text-green-500" />}
              {(availability === 'taken' || availability === 'invalid') && <X className="h-4 w-4 text-red-500" />}
            </span>
          </div>
          {availability === 'taken' && <p className="text-sm text-red-400">That username is taken.</p>}
          {availability === 'invalid' && (
            <p className="text-sm text-red-400">3–20 characters: letters, numbers, underscores.</p>
          )}
        </div>
        <Button type="button" className="mt-4 w-full" disabled={availability !== 'available'} onClick={() => setStep(2)}>
          Continue
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
            <Input id="email" name="email" type="email" autoComplete="email" required />
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
