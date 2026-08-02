'use client'
import { useFormState } from 'react-dom'
import { toggleBettingLocked, type LockBettingState } from '@/lib/betting/admin-actions'

export function BettingLockToggle({ matchId, alreadyLocked }: { matchId: string; alreadyLocked: boolean }) {
  const [state, action] = useFormState<LockBettingState, FormData>(toggleBettingLocked, undefined)
  if (alreadyLocked || state?.success) {
    return <p className="text-xs text-slate-500">Betting locked.</p>
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="matchId" value={matchId} />
      <button type="submit" className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-500/10">
        Lock betting now
      </button>
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  )
}
