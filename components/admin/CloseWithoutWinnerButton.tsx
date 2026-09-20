'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { closeTournamentWithoutWinner, type CloseNoWinnerState } from '@/lib/tournaments/no-winner-actions'
import { SubmitButton } from '@/components/ui/submit-button'

export function CloseWithoutWinnerButton({ id, title }: { id: string; title: string }) {
  const [state, action] = useFormState<CloseNoWinnerState, FormData>(closeTournamentWithoutWinner, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-500/10"
      >
        Close without a winner
      </button>
    )
  }
  return (
    <form action={action} className="flex w-full flex-col gap-2 sm:w-80">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs font-semibold text-amber-400">
        Close {title} with the final left undecided? Neither finalist gets a prize, season points, coins or XP.
        Everyone else keeps their placement rewards. This cannot be undone.
      </p>
      <textarea
        name="reason"
        required
        maxLength={500}
        rows={2}
        placeholder="Reason (kept on the final as an audit note)"
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500"
      />
      <div className="flex gap-2">
        <SubmitButton
          pendingLabel="Closing…"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
        >
          Yes, close it
        </SubmitButton>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Keep open
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
