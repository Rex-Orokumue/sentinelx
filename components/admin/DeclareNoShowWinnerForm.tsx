'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { declareNoShowWinner, type NoShowState } from '@/lib/matches/noshow-actions'

export function DeclareNoShowWinnerForm({
  matchId,
  playerAId,
  playerAName,
  playerBId,
  playerBName,
}: {
  matchId: string
  playerAId: string
  playerAName: string
  playerBId: string
  playerBName: string
}) {
  const [state, action] = useFormState<NoShowState, FormData>(declareNoShowWinner, undefined)
  const [winnerId, setWinnerId] = useState(playerAId)

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
        ✓ No-show winner declared (1-0).
      </div>
    )
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <input type="hidden" name="id" value={matchId} />
      <h3 className="text-sm font-bold text-white">Declare no-show winner</h3>
      <p className="text-xs text-slate-500">
        Use once you have WhatsApp proof the winner tried to reach their opponent and the opponent never responded.
        Records a 1-0 walkover.
      </p>
      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="radio"
            name="winnerId"
            value={playerAId}
            checked={winnerId === playerAId}
            onChange={() => setWinnerId(playerAId)}
          />
          {playerAName} showed up
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="radio"
            name="winnerId"
            value={playerBId}
            checked={winnerId === playerBId}
            onChange={() => setWinnerId(playerBId)}
          />
          {playerBName} showed up
        </label>
      </div>
      <textarea
        name="reason"
        rows={2}
        required
        placeholder="Reason (required) — e.g. WhatsApp proof of contact attempts, opponent unresponsive all day"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="rounded-lg border border-violet-500/40 px-4 py-2 text-xs font-bold text-violet-400 hover:bg-violet-500/10"
      >
        Declare winner
      </button>
    </form>
  )
}
