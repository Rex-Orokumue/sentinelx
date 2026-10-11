import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { spendCoins, recordCoinTransaction } from '@/lib/coins/service'
import { wagerWindowOpen } from './market'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

type Admin = ReturnType<typeof createAdminClient>

export type PlaceWagerErrorCode =
  | 'pending_deletion' | 'match_not_found' | 'own_match' | 'invalid_pick' | 'window_closed' | 'insufficient_coins' | 'wager_failed'
export type PlaceWagerResult = { ok: true } | { ok: false; errorCode: PlaceWagerErrorCode }

export async function performPlaceWager(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  matchId: string,
  input: { pickPlayerId: string; stakeCoins: number },
): Promise<PlaceWagerResult> {
  const restricted = await assertNotPendingDeletion(admin, userId)
  if (restricted) return { ok: false, errorCode: 'pending_deletion' }

  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id, is_full_day')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }
  if (userId === match.player_a_id || userId === match.player_b_id) return { ok: false, errorCode: 'own_match' }
  if (input.pickPlayerId !== match.player_a_id && input.pickPlayerId !== match.player_b_id) return { ok: false, errorCode: 'invalid_pick' }
  if (!wagerWindowOpen(match)) return { ok: false, errorCode: 'window_closed' }

  const { data: existing } = await admin
    .from('match_wagers')
    .select('id, stake_coins')
    .eq('match_id', matchId)
    .eq('bettor_id', userId)
    .maybeSingle()

  const previousStake = existing?.stake_coins ?? 0
  // A new or changed stake is ONE net coin movement, never a refund followed by a re-stake (the old pair could
  // leave a refunded stake and no wager if the second step failed):
  //  - raising: spend the difference (strict) BEFORE saving, and reverse exactly that if the save fails;
  //  - lowering: save the wager FIRST, then credit the difference (so a failed save moves no coins);
  //  - unchanged: save only.
  const delta = previousStake - input.stakeCoins // negative = more coins needed
  let spent = 0
  if (delta < 0) {
    const spend = await spendCoins(admin, userId, -delta, 'wager_stake', matchId, `Wager — match ${matchId}`)
    if (!spend.ok) return { ok: false, errorCode: spend.reason === 'insufficient' ? 'insufficient_coins' : 'wager_failed' }
    spent = -delta
  }

  const { error: upsertErr } = await admin.from('match_wagers').upsert(
    {
      match_id: matchId, bettor_id: userId, pick_player_id: input.pickPlayerId,
      stake_coins: input.stakeCoins, status: 'pending', payout_coins: null, updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,bettor_id' },
  )
  if (upsertErr) {
    if (spent > 0) await recordCoinTransaction(admin, userId, spent, 'wager_refund', matchId, 'Wager save failed — auto-reversed')
    return { ok: false, errorCode: 'wager_failed' }
  }

  if (delta > 0) {
    await recordCoinTransaction(admin, userId, delta, 'wager_refund', matchId, 'Wager changed — stake reduced')
  }

  return { ok: true }
}
