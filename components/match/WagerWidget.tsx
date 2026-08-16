'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { placeWager, type WagerState } from '@/lib/wagers/actions'
import { estimateWagerPayout, MIN_WAGER_STAKE, MAX_WAGER_STAKE, type WagerPools } from '@/lib/wagers/market'
import { coinsToNaira } from '@/lib/coins/value'
import type { MembershipTier } from '@/lib/membership/tiers'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg border border-amber-500/40 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
    >
      {pending ? 'Placing wager…' : 'Place Wager'}
    </button>
  )
}

export function WagerWidget({
  matchId,
  playerAId,
  playerBId,
  playerAName,
  playerBName,
  playerAAvatar,
  playerBAvatar,
  playerATier,
  playerBTier,
  pools,
  myWager,
  coinBalance,
  disabledReason,
  outcome,
}: {
  matchId: string
  playerAId: string
  playerBId: string
  playerAName: string
  playerBName: string
  playerAAvatar: string | null
  playerBAvatar: string | null
  playerATier: MembershipTier
  playerBTier: MembershipTier
  pools: WagerPools
  myWager: { pickPlayerId: string; stakeCoins: number } | null
  coinBalance: number
  disabledReason: string | null
  outcome: { won: boolean; payoutCoins: number; stakeCoins: number } | null
}) {
  const [state, formAction] = useFormState<WagerState, FormData>(placeWager, undefined)
  const [pick, setPick] = useState(myWager?.pickPlayerId ?? playerAId)
  const [stake, setStake] = useState(myWager?.stakeCoins ?? MIN_WAGER_STAKE)

  const total = pools.playerA + pools.playerB
  const pctA = total > 0 ? Math.round((pools.playerA / total) * 100) : 50
  const pctB = 100 - pctA
  const potentialWin = estimateWagerPayout(pools, pick === playerAId ? 'player_a' : 'player_b', stake)

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/20 bg-slate-900 p-5">
      <h3 className="mb-3 text-sm font-bold text-white">🪙 Community Wager</h3>

      <div className="mb-4 grid grid-cols-2 gap-3 text-center text-xs text-slate-400">
        <div className="flex flex-col items-center gap-1">
          <HexAvatar src={playerAAvatar} username={playerAName} tier={playerATier} size="sm" />
          <span className="font-semibold text-white">{playerAName}</span>
          <span>{pools.playerA.toLocaleString()} coins ({pctA}% backing)</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <HexAvatar src={playerBAvatar} username={playerBName} tier={playerBTier} size="sm" />
          <span className="font-semibold text-white">{playerBName}</span>
          <span>{pools.playerB.toLocaleString()} coins ({pctB}% backing)</span>
        </div>
      </div>

      {outcome ? (
        <p
          className={`rounded-lg border p-3 text-center text-sm font-bold ${
            outcome.won ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-slate-800 bg-slate-950 text-slate-400'
          }`}
        >
          {outcome.won ? `You won +${outcome.payoutCoins.toLocaleString()} coins 🎉` : `You lost ${outcome.stakeCoins.toLocaleString()} coins.`}
        </p>
      ) : disabledReason ? (
        <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-center text-xs text-slate-500">{disabledReason}</p>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="matchId" value={matchId} />
          <p className="text-center text-xs text-slate-500">Your balance: {coinBalance.toLocaleString()} coins</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="pickPlayerId" value={playerAId} checked={pick === playerAId} onChange={() => setPick(playerAId)} />
              {playerAName}
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-300">
              <input type="radio" name="pickPlayerId" value={playerBId} checked={pick === playerBId} onChange={() => setPick(playerBId)} />
              {playerBName}
            </label>
          </div>
          <input
            type="number"
            name="stakeCoins"
            min={MIN_WAGER_STAKE}
            max={MAX_WAGER_STAKE}
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
            placeholder={`Stake (${MIN_WAGER_STAKE} – ${MAX_WAGER_STAKE.toLocaleString()} coins)`}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
          />
          <p className="text-center text-xs text-slate-400">
            Potential win: +{potentialWin.toLocaleString()} coins (₦{coinsToNaira(potentialWin).toLocaleString('en-NG')})
          </p>
          {state?.error && <p className="text-center text-xs text-red-400">{state.error}</p>}
          {state?.success && <p className="text-center text-xs text-emerald-400">Wager placed.</p>}
          <SubmitButton />
          <p className="text-center text-[11px] text-slate-600">
            {myWager
              ? `Your wager: ${myWager.stakeCoins.toLocaleString()} coins on ${myWager.pickPlayerId === playerAId ? playerAName : playerBName}`
              : 'Your wager: none yet'}
          </p>
        </form>
      )}
    </div>
  )
}
