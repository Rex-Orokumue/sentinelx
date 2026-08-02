'use client'
import { useFormState } from 'react-dom'
import { voidBet, type VoidBetState } from '@/lib/betting/admin-actions'

function VoidBetRow({ bet }: { bet: { id: string; playerName: string; side: 'player_a' | 'player_b'; stakeAmount: number } }) {
  const [state, action] = useFormState<VoidBetState, FormData>(voidBet, undefined)
  if (state?.success) {
    return <p className="text-xs text-emerald-400">✓ Voided and refunded.</p>
  }
  return (
    <form action={action} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs">
      <input type="hidden" name="betId" value={bet.id} />
      <span className="flex-1 text-slate-300">
        {bet.playerName} — ₦{bet.stakeAmount.toLocaleString()} on {bet.side}
      </span>
      <input
        name="reason"
        placeholder="Reason"
        required
        className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
      <button type="submit" className="rounded border border-red-500/40 px-2 py-1 font-bold text-red-400 hover:bg-red-500/10">
        Void
      </button>
      {state?.error && <span className="text-red-400">{state.error}</span>}
    </form>
  )
}

export function VoidBetsList({
  bets,
}: {
  bets: { id: string; playerName: string; side: 'player_a' | 'player_b'; stakeAmount: number }[]
}) {
  if (bets.length === 0) return null
  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Active bets</h3>
      {bets.map((bet) => (
        <VoidBetRow key={bet.id} bet={bet} />
      ))}
    </div>
  )
}
