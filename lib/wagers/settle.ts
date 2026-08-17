import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { recordCoinTransaction } from '@/lib/coins/service'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { WAGER_FEE_RATE } from './market'

type Admin = SupabaseClient<Database>

export type SettleWager = { id: string; bettorId: string; pickPlayerId: string; stakeCoins: number }

// Pure pro-rata split — a 5% platform fee (WAGER_FEE_RATE) is deducted from
// the losing side's pool before distributing to winners, and the fee cut is
// also returned so the caller can log it to platform_coin_reserve.
export function computeWagerPayouts(
  wagers: SettleWager[],
  winnerId: string,
): { payouts: Map<string, number>; platformFee: number } {
  const payouts = new Map<string, number>()
  const winners = wagers.filter((w) => w.pickPlayerId === winnerId)
  const losers = wagers.filter((w) => w.pickPlayerId !== winnerId)
  const winningPool = winners.reduce((s, w) => s + w.stakeCoins, 0)
  const losingPool = losers.reduce((s, w) => s + w.stakeCoins, 0)

  for (const w of losers) payouts.set(w.id, 0)

  if (winningPool === 0) {
    // Nobody backed the actual winner — no payouts, and no fee is taken
    // since there's no winning side to distribute the losing pool to.
    return { payouts, platformFee: 0 }
  }

  const platformFee = losingPool === 0 ? 0 : Math.floor(losingPool * WAGER_FEE_RATE)
  const distributable = losingPool - platformFee
  for (const w of winners) {
    const payout = w.stakeCoins + Math.floor(distributable * (w.stakeCoins / winningPool))
    payouts.set(w.id, payout)
  }
  return { payouts, platformFee }
}

// Called only from admin-confirmed outcomes (confirmResult) — never from a
// player's own submission. The caller wraps this in try/catch and never
// rolls back the match result on failure (see verify-actions.ts).
export async function settleMatchWagers(admin: Admin, matchId: string, winnerId: string): Promise<void> {
  const { data: rows } = await admin
    .from('match_wagers')
    .select('id, bettor_id, pick_player_id, stake_coins')
    .eq('match_id', matchId)
    .eq('status', 'pending')
  const wagers = (rows ?? []).map((w) => ({ id: w.id, bettorId: w.bettor_id, pickPlayerId: w.pick_player_id, stakeCoins: w.stake_coins }))
  if (wagers.length === 0) return

  const { payouts, platformFee } = computeWagerPayouts(wagers, winnerId)
  const now = new Date().toISOString()

  for (const w of wagers) {
    const payout = payouts.get(w.id) ?? 0
    if (payout > 0) {
      await recordCoinTransaction(admin, w.bettorId, payout, 'wager_won', w.id, `Wager won — match ${matchId}`)
      await admin.from('match_wagers').update({ status: 'won', payout_coins: payout, updated_at: now }).eq('id', w.id)
    } else {
      // A loser's stake was already deducted when the wager was placed
      // (placeWager) — no further coin movement, only the status update.
      await admin.from('match_wagers').update({ status: 'lost', payout_coins: 0, updated_at: now }).eq('id', w.id)
    }
    const won = payout > 0
    const body = won
      ? `You won ${payout} SX Coins on this match.`
      : `Your ${w.stakeCoins}-coin wager didn't hit this time.`
    void notifyInApp({ playerId: w.bettorId, type: 'wager_settled', title: won ? 'Wager won!' : 'Wager settled', body, link: `/matches/${matchId}` })
    void pushToPlayer(w.bettorId, 'wager_settled', { title: won ? 'Wager won!' : 'Wager settled', body }, { url: `/matches/${matchId}` })
  }

  if (platformFee > 0) {
    await admin.from('platform_coin_reserve').insert({ match_id: matchId, coins: platformFee, source: 'wager_fee' })
  }
}

// No real contest happened (draw, dispute, walkover, mutual no-show) — every
// pending wager's stake is returned in full, no fee taken. Scoped to
// status = 'pending' so it's safe to call even when there's nothing to
// refund.
export async function refundMatchWagers(admin: Admin, matchId: string): Promise<void> {
  const { data: rows } = await admin
    .from('match_wagers')
    .select('id, bettor_id, stake_coins')
    .eq('match_id', matchId)
    .eq('status', 'pending')
  const now = new Date().toISOString()
  for (const w of rows ?? []) {
    await recordCoinTransaction(admin, w.bettor_id, w.stake_coins, 'wager_refund', w.id, `Wager refunded — match ${matchId}`)
    await admin.from('match_wagers').update({ status: 'refunded', payout_coins: w.stake_coins, updated_at: now }).eq('id', w.id)
  }
}
