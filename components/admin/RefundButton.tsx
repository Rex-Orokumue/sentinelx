'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { refundRegistration, type RefundState } from '@/lib/tournaments/admin-actions'
import { formatNaira } from '@/lib/format'

export function RefundButton({
  registrationId,
  tournamentId,
  playerId,
  amount,
  reason,
}: {
  registrationId: string
  tournamentId: string
  playerId: string
  amount: number
  reason: string
}) {
  const [state, action] = useFormState<RefundState, FormData>(refundRegistration, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
      >
        Refund
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="reason" value={reason} />
      <p className="text-xs text-amber-400">Refund {formatNaira(amount)}?</p>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
