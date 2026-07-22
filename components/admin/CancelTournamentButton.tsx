'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { cancelTournament, type TournamentFormState } from '@/lib/tournaments/admin-actions'

export function CancelTournamentButton({
  id,
  title,
  paidRegistrations,
}: {
  id: string
  title: string
  paidRegistrations: number
}) {
  const [state, action] = useFormState<TournamentFormState, FormData>(cancelTournament, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        Cancel tournament
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs font-semibold text-amber-400">
        Confirm — cancel {title}? {paidRegistrations} paid registration
        {paidRegistrations === 1 ? '' : 's'} will need manual refunds.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
        >
          Yes, cancel
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Keep tournament
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
