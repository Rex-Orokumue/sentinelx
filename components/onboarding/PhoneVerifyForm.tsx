'use client'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { requestPhoneCode, confirmPhoneCode, type PhoneActionState } from '@/lib/phone/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

export function PhoneVerifyForm({ onVerified }: { onVerified?: () => void }) {
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [requestState, requestAction] = useFormState<PhoneActionState, FormData>(requestPhoneCode, undefined)
  const [confirmState, confirmAction] = useFormState<PhoneActionState, FormData>(confirmPhoneCode, undefined)

  useEffect(() => {
    if (requestState?.success) setStage('code')
  }, [requestState])

  useEffect(() => {
    if (confirmState?.success) onVerified?.()
  }, [confirmState, onVerified])

  if (confirmState?.success) {
    return (
      <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-400">
        ✓ Phone verified.
      </p>
    )
  }

  if (stage === 'code') {
    return (
      <form action={confirmAction} className="space-y-4">
        <p className="text-sm text-slate-400">Enter the 6-digit code we sent on WhatsApp.</p>
        <div className="space-y-1.5">
          <Label htmlFor="code">Code</Label>
          <Input id="code" name="code" inputMode="numeric" maxLength={6} required autoFocus />
        </div>
        {confirmState?.error && <p className="text-sm text-red-400">{confirmState.error}</p>}
        <SubmitButton label="Verify" pendingLabel="Verifying…" />
        <button
          type="button"
          onClick={() => setStage('phone')}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Use a different number
        </button>
      </form>
    )
  }

  return (
    <form action={requestAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <Input id="phone" name="phone" type="tel" placeholder="+2348012345678" required autoFocus />
      </div>
      {requestState?.error && <p className="text-sm text-red-400">{requestState.error}</p>}
      <SubmitButton label="Send code" pendingLabel="Sending…" />
    </form>
  )
}
