'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { debitWallet, creditWallet } from '@/lib/wallet/service'
import { placeBetSchema } from './schema'
import { bettingOpen } from './market'

export type BetState = { error?: string; success?: boolean } | undefined

export async function placeBet(_prev: BetState, formData: FormData): Promise<BetState> {
  const parsed = placeBetSchema.safeParse({
    matchId: formData.get('matchId'),
    side: formData.get('side'),
    stakeAmount: formData.get('stakeAmount'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { matchId, side, stakeAmount } = parsed.data

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to place a bet.' }

  const admin = createAdminClient()
  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, betting_locked, player_a_id, player_b_id')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }
  if (user.id === match.player_a_id || user.id === match.player_b_id) {
    return { error: 'You cannot bet on your own match.' }
  }
  if (!bettingOpen(match)) return { error: 'Betting is closed for this match.' }

  const debit = await debitWallet(admin, user.id, stakeAmount, 'bet_stake', matchId)
  if (!debit.ok) return { error: debit.error }

  const { error: insertErr } = await admin
    .from('match_bets')
    .insert({ match_id: matchId, player_id: user.id, side, stake_amount: stakeAmount })
  if (insertErr) {
    // Undo the debit — the player must never lose money for a bet that
    // wasn't actually recorded. Mirrors the withdrawal-request rollback
    // pattern in lib/wallet/actions.ts.
    await creditWallet(admin, user.id, stakeAmount, 'bet_refund', matchId, 'Bet insert failed — auto-reversed')
    return { error: 'Could not place your bet. Please try again.' }
  }

  revalidatePath(`/matches/${matchId}`)
  revalidatePath('/betting')
  return { success: true }
}
