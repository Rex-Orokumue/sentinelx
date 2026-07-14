'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { friendlyMatchEventsFor } from './scoring'
import { computeScore } from '@/lib/scoring/score'
import { creditWallet } from '@/lib/wallet/service'
import { friendlyResultSchema } from './result-schema'

export type FriendlyAdminState = { error?: string; success?: boolean } | undefined

export async function confirmFriendlyResult(
  _prev: FriendlyAdminState,
  formData: FormData,
): Promise<FriendlyAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const parsed = friendlyResultSchema.safeParse({
    scoreChallenger: formData.get('scoreChallenger'),
    scoreOpponent: formData.get('scoreOpponent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const admin = createAdminClient()
  const { data: fm } = await admin
    .from('friendly_matches')
    .select('id, challenger_id, opponent_id, stake_amount, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (fm.status !== 'awaiting_admin_confirmation') return { error: 'This match is not awaiting confirmation.' }
  // Only staked friendlies need a winner (to receive the pot) — a free
  // friendly can end in a draw like any casual match.
  if (fm.stake_amount && parsed.data.scoreChallenger === parsed.data.scoreOpponent) {
    return { error: 'A staked friendly match cannot end in a draw — dispute it instead.' }
  }

  const winnerId =
    parsed.data.scoreChallenger === parsed.data.scoreOpponent
      ? null
      : parsed.data.scoreChallenger > parsed.data.scoreOpponent
        ? fm.challenger_id
        : fm.opponent_id

  const { error } = await admin
    .from('friendly_matches')
    .update({
      score_challenger: parsed.data.scoreChallenger,
      score_opponent: parsed.data.scoreOpponent,
      winner_id: winnerId,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not confirm the result. Please try again.' }

  // Staked friendlies only — Sentinel Score events + balance eligibility.
  if (fm.stake_amount) {
    const events = friendlyMatchEventsFor({
      id: fm.id,
      challengerId: fm.challenger_id,
      opponentId: fm.opponent_id,
      scoreChallenger: parsed.data.scoreChallenger,
      scoreOpponent: parsed.data.scoreOpponent,
      winnerId,
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

    // winnerId is guaranteed non-null here — a draw on a staked match was
    // already rejected above, before this block can be reached.
    await creditWallet(admin, winnerId as string, fm.stake_amount * 2, 'friendly_stake', fm.id)
  }

  for (const playerId of [fm.challenger_id, fm.opponent_id]) {
    await notifyInApp({
      playerId,
      type: 'result_confirmed',
      title: 'Friendly match confirmed',
      body:
        winnerId === null
          ? 'Your friendly match ended in a draw — confirmed by admin.'
          : playerId === winnerId
            ? 'You won your friendly match — confirmed by admin.'
            : 'Your friendly match result was confirmed by admin.',
      link: `/dashboard/friendlies/${fm.id}`,
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
