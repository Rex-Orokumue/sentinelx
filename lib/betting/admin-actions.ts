'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { creditWallet } from '@/lib/wallet/service'

export type VoidBetState = { error?: string; success?: boolean } | undefined

// Voiding is per-bet, not per-match — unlike refundMatchBets (lib/betting/settle.ts),
// which refunds every active bet on a match because the whole contest didn't
// happen. This unwinds a single bet an admin judges to have been placed with
// insider knowledge, leaving everyone else's bets on the match untouched.
export async function voidBet(_prev: VoidBetState, formData: FormData): Promise<VoidBetState> {
  await requireAdmin()
  const betId = String(formData.get('betId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!betId) return { error: 'Missing bet.' }
  if (!reason) return { error: 'Enter a reason for voiding this bet.' }

  const admin = createAdminClient()
  const { data: bet } = await admin
    .from('match_bets')
    .select('id, player_id, stake_amount, status')
    .eq('id', betId)
    .maybeSingle()
  if (!bet) return { error: 'Bet not found.' }
  if (bet.status !== 'active') return { error: 'This bet has already been settled and can no longer be voided.' }

  await creditWallet(admin, bet.player_id, bet.stake_amount, 'bet_refund', bet.id, reason)
  await admin.from('match_bets').update({ status: 'voided', voided_reason: reason }).eq('id', betId)

  revalidatePath('/admin/matches')
  return { success: true }
}

export type LockBettingState = { error?: string; success?: boolean } | undefined

export async function toggleBettingLocked(_prev: LockBettingState, formData: FormData): Promise<LockBettingState> {
  await requireAdmin()
  const matchId = String(formData.get('matchId') ?? '')
  if (!matchId) return { error: 'Missing match.' }

  const admin = createAdminClient()
  // One-way: this only ever sets betting_locked to true. There is no
  // "unlock" action — reopening betting once it's closed would recreate the
  // insider-betting risk the automatic lock at scheduled_at exists to avoid.
  const { error } = await admin.from('matches').update({ betting_locked: true }).eq('id', matchId)
  if (error) return { error: 'Could not lock betting. Please try again.' }

  revalidatePath(`/admin/matches/${matchId}/review`)
  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
