'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { recomputeAllAction, type RecomputeState } from '@/lib/scoring/admin-actions'

export function RecomputeButton() {
  const [state, action] = useFormState<RecomputeState, FormData>(recomputeAllAction, undefined)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="font-bold text-white">Recompute all scores &amp; stats</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Rebuilds every player&apos;s aggregates and Sentinel Score from match history and the
        events log. Safe to run anytime; use it to recover from a scoring bug.
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500"
        >
          Recompute all…
        </button>
      ) : (
        <form action={action} className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-amber-400">
            This recomputes scores for all players. Are you sure?
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500"
            >
              Yes, recompute all players
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {state?.players != null && (
        <p className="mt-2 text-xs text-emerald-400">Recomputed {state.players} players.</p>
      )}
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
