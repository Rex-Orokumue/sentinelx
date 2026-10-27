'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { recordManualPayment, type ManualPaymentState } from '@/lib/seasons/manual-payment-actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
      {pending ? 'Recording…' : 'Confirm payment'}
    </button>
  )
}

export function ManualPaymentForm({ tournamentId, playerId, username, fee }: {
  tournamentId: string
  playerId: string
  username: string
  fee: number
}) {
  const [open, setOpen] = useState(false)
  const [state, action] = useFormState<ManualPaymentState, FormData>(recordManualPayment, undefined)

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-300">
      Record outside payment
    </button>
  )

  return (
    <form action={action} className="mt-2 min-w-64 space-y-2 rounded-xl border border-emerald-900 bg-slate-950 p-3 text-left">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <p className="text-xs text-slate-300">Record a verified transfer for <strong>{username}</strong>. Check your bank records first; this does not collect money.</p>
      <label className="block text-xs text-slate-300">Amount received (₦)
        <input name="amount" type="number" min="1" step="1" defaultValue={fee} required
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
      </label>
      <label className="block text-xs text-slate-300">Payment channel
        <select name="channel" defaultValue="bank_transfer"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="block text-xs text-slate-300">Transaction reference
        <input name="reference" minLength={4} maxLength={120} required placeholder="Bank transaction ID"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
      </label>
      <label className="block text-xs text-slate-300">Note (optional)
        <textarea name="note" maxLength={500} rows={2}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
      </label>
      <label className="flex items-start gap-2 text-xs text-slate-300">
        <input name="verified" value="yes" type="checkbox" required className="mt-0.5" />
        I checked this payment in the bank or provider records.
      </label>
      {state?.error && <p role="alert" className="text-xs text-red-400">{state.error}</p>}
      {state?.success && <p role="status" className="text-xs text-emerald-400">Payment recorded.</p>}
      <div className="flex flex-wrap gap-2">
        <SubmitButton />
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-xs text-slate-400">Cancel</button>
      </div>
    </form>
  )
}
