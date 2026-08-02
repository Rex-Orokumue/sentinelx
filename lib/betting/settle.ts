import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { creditWallet } from '@/lib/wallet/service'
import { RAKE_RATE, type Side } from './market'

type Admin = SupabaseClient<Database>

export type SettleBet = { id: string; side: Side; stakeAmount: number }

// Pure pari-mutuel split: the losing side's pool, minus the platform rake,
// is redistributed to winners proportional to their stake. Payouts are
// rounded down (Math.floor) to whole naira — wallets deal in integers, and
// under-paying by a fraction of a naira across many winners is preferable
// to a rounding-driven over-payment that could push the pool negative.
export function computePariMutuelPayouts(bets: SettleBet[], winningSide: Side): Map<string, number> {
  const payouts = new Map<string, number>()
  const winners = bets.filter((b) => b.side === winningSide)
  const losers = bets.filter((b) => b.side !== winningSide)
  const winningPool = winners.reduce((sum, b) => sum + b.stakeAmount, 0)
  const losingPool = losers.reduce((sum, b) => sum + b.stakeAmount, 0)

  for (const bet of losers) payouts.set(bet.id, 0)

  if (winningPool === 0) {
    // Nobody backed the actual winner — no payouts, losing pool isn't
    // redistributed since there's no one to redistribute it to.
    return payouts
  }

  const distributable = losingPool === 0 ? 0 : losingPool * (1 - RAKE_RATE)
  for (const bet of winners) {
    const payout = bet.stakeAmount + Math.floor(distributable * (bet.stakeAmount / winningPool))
    payouts.set(bet.id, payout)
  }
  return payouts
}

// Called only from admin-confirmed outcomes (confirmResult, declareNoShowWinner,
// markBothNoShow) — never from a player's own submission.
export async function settleMatchBets(admin: Admin, matchId: string, winningSide: Side): Promise<void> {
  const { data: bets } = await admin
    .from('match_bets')
    .select('id, player_id, side, stake_amount')
    .eq('match_id', matchId)
    .eq('status', 'active')
  const active = bets ?? []
  if (active.length === 0) return

  const payouts = computePariMutuelPayouts(
    active.map((b) => ({ id: b.id, side: b.side as Side, stakeAmount: b.stake_amount })),
    winningSide,
  )
  const now = new Date().toISOString()

  for (const bet of active) {
    const payout = payouts.get(bet.id) ?? 0
    if (payout > 0) {
      await creditWallet(admin, bet.player_id, payout, 'bet_payout', bet.id)
      await admin.from('match_bets').update({ status: 'won', payout_amount: payout, settled_at: now }).eq('id', bet.id)
    } else {
      await admin.from('match_bets').update({ status: 'lost', payout_amount: 0, settled_at: now }).eq('id', bet.id)
    }
  }
}

// No real contest happened (no-show, forfeit, or a group-stage draw) — every
// active bet's stake is returned, no rake taken.
export async function refundMatchBets(admin: Admin, matchId: string): Promise<void> {
  const { data: bets } = await admin
    .from('match_bets')
    .select('id, player_id, stake_amount')
    .eq('match_id', matchId)
    .eq('status', 'active')
  const now = new Date().toISOString()
  for (const bet of bets ?? []) {
    await creditWallet(admin, bet.player_id, bet.stake_amount, 'bet_refund', bet.id)
    await admin.from('match_bets').update({ status: 'refunded', payout_amount: bet.stake_amount, settled_at: now }).eq('id', bet.id)
  }
}
