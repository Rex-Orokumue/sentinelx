'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { sendChallenge, type FriendlyActionState } from '@/lib/friendly-matches/actions'

export function ChallengeButton({ opponentId }: { opponentId: string }) {
  const [showStake, setShowStake] = useState(false)
  const [state, action] = useFormState<FriendlyActionState, FormData>(sendChallenge, undefined)

  if (state?.success) return <p className="text-sm text-emerald-400">Challenge sent.</p>

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="opponentId" value={opponentId} />
      <input
        name="gameCode"
        type="text"
        maxLength={100}
        placeholder="Game code (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={showStake} onChange={(e) => setShowStake(e.target.checked)} />
          Add a stake
        </label>
      </div>
      {showStake && (
        <input
          name="stakeAmount"
          type="number"
          min={100}
          placeholder="Stake amount (₦)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      )}
      <button
        type="submit"
        className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        {showStake ? 'Send staked challenge' : 'Challenge to a friendly'}
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
