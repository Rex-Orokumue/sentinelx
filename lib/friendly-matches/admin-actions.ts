'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { friendlyMatchEventsFor } from './scoring'
import { computeScore } from '@/lib/scoring/score'

export type FriendlyAdminState = { error?: string; success?: boolean } | undefined

export async function confirmFriendlyResult(
  _prev: FriendlyAdminState,
  formData: FormData,
): Promise<FriendlyAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const admin = createAdminClient()
  const { data: fm } = await admin
    .from('friendly_matches')
    .select('id, challenger_id, opponent_id, stake_amount, score_challenger, score_opponent, winner_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (fm.status !== 'awaiting_admin_confirmation') return { error: 'This match is not awaiting confirmation.' }

  const { error } = await admin
    .from('friendly_matches')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Could not confirm the result. Please try again.' }

  // Staked friendlies only — Sentinel Score events + balance eligibility.
  // Free friendlies never reach here with a stake_amount, so this whole
  // block is a no-op for them by construction.
  if (fm.stake_amount && fm.winner_id) {
    const events = friendlyMatchEventsFor({
      id: fm.id,
      challengerId: fm.challenger_id,
      opponentId: fm.opponent_id,
      scoreChallenger: fm.score_challenger,
      scoreOpponent: fm.score_opponent,
      winnerId: fm.winner_id,
    })
    await admin.from('sentinel_score_events').insert(events)

    for (const playerId of [fm.challenger_id, fm.opponent_id]) {
      const { data: scoreEvents } = await admin
        .from('sentinel_score_events')
        .select('points_delta')
        .eq('player_id', playerId)
      await admin
        .from('profiles')
        .update({ sentinel_score: computeScore(scoreEvents ?? []) })
        .eq('id', playerId)
    }
  }

  for (const playerId of [fm.challenger_id, fm.opponent_id]) {
    await notifyInApp({
      playerId,
      type: 'result_confirmed',
      title: 'Friendly match confirmed',
      body:
        playerId === fm.winner_id
          ? 'You won your friendly match — confirmed by admin.'
          : 'Your friendly match result was confirmed by admin.',
      link: '/dashboard',
    })
  }

  revalidatePath('/admin/friendlies')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function disputeFriendlyResult(
  _prev: FriendlyAdminState,
  formData: FormData,
): Promise<FriendlyAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!note) return { error: 'Enter a reason for the dispute.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('friendly_matches')
    .update({ status: 'disputed', admin_note: note })
    .eq('id', id)
  if (error) return { error: 'Could not save the dispute.' }

  revalidatePath('/admin/friendlies')
  return { success: true }
}
