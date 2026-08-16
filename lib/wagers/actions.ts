'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { placeWagerSchema } from './schema'
import { wagerWindowOpen } from './market'

export type WagerState = { error?: string; success?: boolean } | undefined

export async function placeWager(_prev: WagerState, formData: FormData): Promise<WagerState> {
  const parsed = placeWagerSchema.safeParse({
    matchId: formData.get('matchId'),
    pickPlayerId: formData.get('pickPlayerId'),
    stakeCoins: formData.get('stakeCoins'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { matchId, pickPlayerId, stakeCoins } = parsed.data

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to place a wager.' }

  const admin = createAdminClient()
  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id, is_full_day')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }
  if (user.id === match.player_a_id || user.id === match.player_b_id) {
    return { error: 'You cannot wager on your own match.' }
  }
  if (pickPlayerId !== match.player_a_id && pickPlayerId !== match.player_b_id) {
    return { error: 'Pick must be one of the two players in this match.' }
  }
  if (!wagerWindowOpen(match)) return { error: 'Wagering is closed for this match.' }

  const { data: existing } = await admin
    .from('match_wagers')
    .select('id, stake_coins')
    .eq('match_id', matchId)
    .eq('bettor_id', user.id)
    .maybeSingle()

  // Changing an existing wager (spec §5: "can change stake up until window
  // closes") refunds the old stake before checking/deducting the new one —
  // never double-charges for the same wager. Both coin movements reference
  // matchId, not the wager row's id — mirrors placeBet's debitWallet call
  // (lib/betting/actions.ts), which references matchId for the same reason:
  // at debit time there's no settled row id to point to yet.
  const previousStake = existing?.stake_coins ?? 0
  const balance = await getCoinBalance(admin, user.id)
  if (balance + previousStake < stakeCoins) return { error: 'Not enough SX Coins for this stake.' }

  if (previousStake > 0) {
    await recordCoinTransaction(admin, user.id, previousStake, 'wager_refund', matchId, 'Wager changed — previous stake refunded')
  }
  await recordCoinTransaction(admin, user.id, -stakeCoins, 'wager_stake', matchId, `Wager — match ${matchId}`)

  const { error: upsertErr } = await admin.from('match_wagers').upsert(
    {
      match_id: matchId,
      bettor_id: user.id,
      pick_player_id: pickPlayerId,
      stake_coins: stakeCoins,
      status: 'pending',
      payout_coins: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,bettor_id' },
  )
  if (upsertErr) {
    // Undo the debit — mirrors placeBet's rollback-on-insert-failure pattern
    // (lib/betting/actions.ts). A player must never lose coins for a wager
    // that wasn't actually recorded.
    await recordCoinTransaction(admin, user.id, stakeCoins, 'wager_refund', matchId, 'Wager save failed — auto-reversed')
    return { error: 'Could not place your wager. Please try again.' }
  }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
