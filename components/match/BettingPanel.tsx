'use client'
import Link from 'next/link'
import { useFormState } from 'react-dom'
import { placeBet, type BetState } from '@/lib/betting/actions'
import { impliedPayoutMultiplier, type SidePools, type Side } from '@/lib/betting/market'

export function BettingPanel({
  matchId,
  playerAName,
  playerBName,
  pools,
  myBets,
  disabledReason,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  pools: SidePools
  myBets: { side: Side; stakeAmount: number; status: string }[]
  disabledReason: string | null
}) {
  const [state, action] = useFormState<BetState, FormData>(placeBet, undefined)

  const multiplierA = impliedPayoutMultiplier(pools, 'player_a')
  const multiplierB = impliedPayoutMultiplier(pools, 'player_b')

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="mb-3 text-sm font-bold text-white">Place a bet</h3>

      {myBets.length > 0 && (
        <ul className="mb-4 space-y-1 text-xs text-slate-400">
          {myBets.map((b, i) => (
            <li key={i}>
              ₦{b.stakeAmount.toLocaleString()} on {b.side === 'player_a' ? playerAName : playerBName} — {b.status}
            </li>
          ))}
        </ul>
      )}

      {disabledReason ? (
        <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-500">{disabledReason}</p>
      ) : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="matchId" value={matchId} />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="side" value="player_a" defaultChecked />
              {playerAName} · {multiplierA ? `${multiplierA.toFixed(2)}x` : '—'}
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="side" value="player_b" />
              {playerBName} · {multiplierB ? `${multiplierB.toFixed(2)}x` : '—'}
            </label>
          </div>
          <input
            type="number"
            name="stakeAmount"
            min={100}
            max={50000}
            placeholder="Stake (₦100 – ₦50,000)"
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
          {state?.error && (
            <p className="text-xs text-red-400">
              {state.error}
              {state.error === 'Insufficient wallet balance.' && (
                <>
                  {' '}
                  <Link href="/dashboard#wallet" className="font-bold text-violet-400 hover:text-violet-300">
                    Fund wallet →
                  </Link>
                </>
              )}
            </p>
          )}
          {state?.success && <p className="text-xs text-emerald-400">Bet placed.</p>}
          <button
            type="submit"
            className="w-full rounded-lg border border-violet-500/40 px-4 py-2 text-xs font-bold text-violet-400 hover:bg-violet-500/10"
          >
            Place bet
          </button>
        </form>
      )}
    </div>
  )
}
