'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { noShowDeadlinePassed } from './noshow'
import { nextRoundName } from '@/lib/tournaments/advancement'
import { recomputeGroupAndMaybeAdvance, advanceKnockout, revalidateAll } from './verify-actions'
import { syncMatchEvents } from '@/lib/scoring/apply'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { resultKey } from '@/lib/notifications/keys'

type Admin = ReturnType<typeof createAdminClient>

interface PendingMatch {
  id: string
  tournament_id: string
  round: string
  group_id: string | null
  scheduled_at: string | null
}

// The deadline sweep: any scheduled/live match whose WAT day has fully
// elapsed gets auto-resolved — a group match becomes a 0-0 no_show_draw,
// a knockout match becomes 'forfeited' (both players eliminated, no
// advancer — see advanceKnockout's leftover-to-bye handling). Called by
// both the daily cron and the admin "Resolve pending matches" button —
// the system must never depend on the cron alone.
export async function resolvePendingNoShowMatches(
  admin: Admin,
  tournamentId?: string,
): Promise<{ drawn: number; forfeited: number }> {
  const now = new Date()
  let query = admin
    .from('matches')
    .select('id, tournament_id, round, group_id, scheduled_at')
    .in('status', ['scheduled', 'live'])
    .not('scheduled_at', 'is', null)
  if (tournamentId) query = query.eq('tournament_id', tournamentId)
  const { data } = await query

  let drawn = 0
  let forfeited = 0
  for (const m of (data ?? []) as PendingMatch[]) {
    if (!noShowDeadlinePassed(m.scheduled_at, now)) continue
    if (m.round === 'group') {
      await admin
        .from('matches')
        .update({
          status: 'completed',
          resolution: 'no_show_draw',
          score_a: 0,
          score_b: 0,
          completed_at: now.toISOString(),
          admin_note: 'Auto-resolved: no result submitted by the match deadline.',
        })
        .eq('id', m.id)
      if (m.group_id) await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
      await syncMatchEvents(admin, m.id)
      drawn += 1
    } else {
      await admin
        .from('matches')
        .update({
          status: 'forfeited',
          completed_at: now.toISOString(),
          admin_note: 'Auto-resolved: no result submitted by the match deadline — both players forfeit.',
        })
        .eq('id', m.id)
      await advanceKnockout(admin, m.tournament_id, m.round)
      await syncMatchEvents(admin, m.id)
      forfeited += 1
    }
  }
  return { drawn, forfeited }
}

export type NoShowState = { error?: string; success?: boolean } | undefined

// Admin declares a winner for a single no-show, after receiving WhatsApp proof
// of contact attempts out-of-band. Also the correction path for an already
// auto-resolved match — except a knockout 'forfeited' match whose next round
// has already been generated, which is locked (reconciling an orphaned bye
// is out of scope; admin resolves by hand).
export async function declareNoShowWinner(_prev: NoShowState, formData: FormData): Promise<NoShowState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const winnerId = String(formData.get('winnerId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!id || !winnerId) return { error: 'Missing match or winner.' }
  if (!reason) return { error: 'Enter a reason (e.g. WhatsApp proof of contact attempts).' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, status, resolution, player_a_id, player_b_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  if (!m.player_a_id || !m.player_b_id) return { error: 'This match has no opponent assigned yet.' }
  if (winnerId !== m.player_a_id && winnerId !== m.player_b_id) return { error: 'Winner must be one of the two players.' }

  const eligible =
    m.status === 'scheduled' ||
    m.status === 'live' ||
    m.status === 'forfeited' ||
    (m.status === 'completed' && (m.resolution === 'walkover' || m.resolution === 'no_show_draw'))
  if (!eligible) {
    return { error: 'This match already has a normally confirmed result and cannot be overridden here.' }
  }

  if (m.status === 'forfeited') {
    const nr = nextRoundName(m.round)
    if (nr) {
      const { count } = await admin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', m.tournament_id)
        .eq('round', nr)
      if (count && count > 0) {
        return {
          error:
            'The next round has already been generated from this forfeit — it can no longer be overridden automatically. Cancel the incorrect bye match and re-run advancement by hand.',
        }
      }
    }
  }

  const scoreA = winnerId === m.player_a_id ? 3 : 0
  const scoreB = winnerId === m.player_b_id ? 3 : 0

  const { error: upErr } = await admin
    .from('matches')
    .update({
      status: 'completed',
      resolution: 'walkover',
      score_a: scoreA,
      score_b: scoreB,
      completed_at: new Date().toISOString(),
      admin_note: reason,
    })
    .eq('id', id)
  if (upErr) return { error: 'Could not save the result. Please try again.' }

  if (m.round === 'group' && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (m.round !== 'group') {
    await advanceKnockout(admin, m.tournament_id, m.round)
  }
  await syncMatchEvents(admin, id)

  const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament
  await notify({
    type: 'result_confirmed',
    playerId: winnerId,
    dedupeKey: resultKey(id, winnerId),
    playerA: winnerId === m.player_a_id ? 'You' : 'Opponent',
    playerB: winnerId === m.player_a_id ? 'Opponent' : 'You',
    scoreA,
    scoreB,
    tournament: '',
  })
  await notifyInApp({
    playerId: winnerId,
    type: 'result_confirmed',
    title: 'Result confirmed',
    body: `Your opponent didn't show — you're marked as the winner (3-0).`,
    link: `/matches/${id}`,
  })

  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}

export type ResolveState = { error?: string; success?: boolean; resolved?: number } | undefined

// Manual fallback for the daily cron — the system must not depend on the
// cron alone. Scoped to one tournament via the admin matches page.
export async function triggerResolvePendingMatches(_prev: ResolveState, formData: FormData): Promise<ResolveState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { drawn, forfeited } = await resolvePendingNoShowMatches(admin, tournamentId)

  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true, resolved: drawn + forfeited }
}
