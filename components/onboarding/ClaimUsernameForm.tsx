'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Check, X, Loader2 } from 'lucide-react'
import { claimUsername, type ClaimUsernameState } from '@/lib/onboarding/actions'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={disabled || pending}>
      {pending ? 'Saving…' : 'Continue'}
    </Button>
  )
}

export function ClaimUsernameForm() {
  const [username, setUsername] = useState('')
  const [state, formAction] = useFormState<ClaimUsernameState, FormData>(claimUsername, undefined)
  const availability = useUsernameAvailability(username)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="username-input">Username</Label>
        <div className="relative">
          <Input
            id="username-input"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
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
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton disabled={availability !== 'available'} />
    </form>
  )
}
