'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { triggerResolvePendingMatches, type ResolveState } from '@/lib/matches/noshow-actions'

export function ResolvePendingMatchesButton({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useFormState<ResolveState, FormData>(triggerResolvePendingMatches, undefined)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
      >
        Check for no-shows now
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <p className="text-xs text-amber-400">
        Flags any match past its deadline with no confirmed result for your review — nothing is scored
        automatically. Continue?
      </p>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
      {state?.success && <span className="text-xs text-emerald-400">Flagged {state.flagged} match(es) for review.</span>}
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  )
}
