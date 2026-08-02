'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { noShowDeadlinePassed } from './noshow'
import { nextRoundName } from '@/lib/tournaments/advancement'
import { recomputeGroupAndMaybeAdvance, advanceKnockout } from './verify-actions'
import { revalidateAll } from './revalidate'
import { syncMatchEvents } from '@/lib/scoring/apply'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { resultKey, noshowKey } from '@/lib/notifications/keys'
import { getNotifiableStaffIds } from '@/lib/admin/staff'
import { canMarkBothNoShow } from './noshow-eligibility'
import { resolvePlayerPhone } from './admin-whatsapp'
import { refundMatchBets } from '@/lib/betting/settle'

type Admin = ReturnType<typeof createAdminClient>

// A walkover is recorded as 1-0, not 3-0. The scoreline isn't cosmetic: walkover
// goals feed group goal difference and goals-for tiebreakers
// (lib/tournaments/standings.ts), profiles.goals_scored (lib/scoring/stats.ts),
// and Golden Boot selection (lib/hall-of-fame/awards.ts). A 3-0 hands a player
// who never kicked a ball three goals toward the Golden Boot and a +3 swing in
// their group; 1-0 is the smallest margin that still settles the tie.
const WALKOVER_SCORE = 1

// Contact fields are selected so the staff alert can carry tap-to-chat links.
type PendingProfile = {
  display_name: string | null
  username: string | null
  whatsapp_number: string | null
  country: string | null
}

interface PendingMatch {
  id: string
  tournament_id: string
  round: string
  group_id: string | null
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  player_a: PendingProfile | PendingProfile[] | null
  player_b: PendingProfile | PendingProfile[] | null
  tournament: { title: string } | { title: string }[] | null
}

function firstOf<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

function nameOf(p: PendingMatch['player_a']): string {
  const row = firstOf(p)
  return row?.display_name ?? row?.username ?? 'TBD'
}

// The deadline sweep: flags any scheduled/live match whose WAT day has fully
// elapsed and alerts staff. It NEVER writes a score or status — every
// resolution (walkover, mutual no-show, or leaving it alone) is now an
// explicit admin action (declareNoShowWinner / markBothNoShow). Called by
// both the hourly cron (unchanged cadence) and the admin "Check for
// no-shows now" button — the system must never depend on the cron alone.
export async function resolvePendingNoShowMatches(
  admin: Admin,
  tournamentId?: string,
): Promise<{ flagged: number }> {
  const now = new Date()
  let query = admin
    .from('matches')
    .select(
      'id, tournament_id, round, group_id, scheduled_at, player_a_id, player_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username, whatsapp_number, country), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username, whatsapp_number, country), ' +
        'tournament:tournaments(title)',
    )
    .in('status', ['scheduled', 'live'])
    .not('scheduled_at', 'is', null)
    .is('noshow_flagged_at', null)
  if (tournamentId) query = query.eq('tournament_id', tournamentId)
  const { data } = await query

  const pending = ((data as unknown[] | null) ?? []) as PendingMatch[]
  const due = pending.filter((m) => noShowDeadlinePassed(m.scheduled_at, now))
  if (due.length === 0) return { flagged: 0 }

  const staffIds = await getNotifiableStaffIds(admin)

  // Registration numbers for everyone involved, in one query — the per-tournament
  // number takes precedence over the profile one (see resolvePlayerPhone).
  const { data: regRows } = await admin
    .from('tournament_registrations')
    .select('tournament_id, player_id, reg_whatsapp')
    .in('tournament_id', Array.from(new Set(due.map((m) => m.tournament_id))))
  const regWhatsappByPlayer = new Map(
    ((regRows as { tournament_id: string; player_id: string; reg_whatsapp: string | null }[] | null) ?? []).map(
      (r) => [`${r.tournament_id}:${r.player_id}`, r.reg_whatsapp],
    ),
  )

  for (const m of due) {
    await admin.from('matches').update({ noshow_flagged_at: now.toISOString() }).eq('id', m.id)

    const tournamentTitle = firstOf(m.tournament)?.title ?? 'Tournament'
    const playerA = nameOf(m.player_a)
    const playerB = nameOf(m.player_b)
    // Staff get tap-to-chat links in the alert itself, so chasing a stalled
    // match doesn't start with hunting for whose number is whose.
    const [urlA, urlB] = [
      [m.player_a_id, m.player_a] as const,
      [m.player_b_id, m.player_b] as const,
    ].map(([playerId, profile]) => {
      const p = firstOf(profile)
      const phone = playerId
        ? resolvePlayerPhone({
            regWhatsapp: regWhatsappByPlayer.get(`${m.tournament_id}:${playerId}`),
            profileWhatsapp: p?.whatsapp_number,
            country: p?.country,
          })
        : null
      return phone ? `https://wa.me/${phone.waNumber}` : null
    })
    for (const staffId of staffIds) {
      await notify({
        type: 'noshow_needs_decision',
        playerId: staffId,
        dedupeKey: noshowKey(m.id, staffId),
        tournament: tournamentTitle,
        round: m.round,
        playerA,
        playerB,
        playerAWhatsAppUrl: urlA,
        playerBWhatsAppUrl: urlB,
      })
      await notifyInApp({
        playerId: staffId,
        type: 'noshow_needs_decision',
        title: 'No-show needs a decision',
        body: `${tournamentTitle} — ${playerA} vs ${playerB} passed its deadline with no confirmed result.`,
        link: `/admin/matches/${m.id}/review`,
      })
    }
  }
  return { flagged: due.length }
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

  const scoreA = winnerId === m.player_a_id ? WALKOVER_SCORE : 0
  const scoreB = winnerId === m.player_b_id ? WALKOVER_SCORE : 0

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

  // A walkover isn't a real contest — refund rather than settle, so nobody
  // can profit from betting on the declared winner after the fact.
  await refundMatchBets(admin, id)

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
    body: `Your opponent didn't show — you're marked as the winner (${WALKOVER_SCORE}-0).`,
    link: `/matches/${id}`,
  })

  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}

// The only remaining path to a mutual 0-0 draw / forfeit — deliberate,
// admin-triggered, and only usable when the sweep has already flagged the
// match AND nobody submitted anything (canMarkBothNoShow). Reuses the exact
// write shape the old automatic sweep used to write, plus the same
// post-processing pipeline declareNoShowWinner uses.
export async function markBothNoShow(_prev: NoShowState, formData: FormData): Promise<NoShowState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!reason) return { error: 'Enter a reason (e.g. neither player responded to contact attempts).' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, status, noshow_flagged_at, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const { count } = await admin
    .from('match_results')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', id)
  const submissionCount = count ?? 0

  if (!canMarkBothNoShow({ status: m.status, noshowFlaggedAt: m.noshow_flagged_at, submissionCount })) {
    return {
      error:
        submissionCount > 0
          ? 'This match has a submitted result — use "Declare no-show winner" or confirm the result instead.'
          : 'This match has not been flagged as stale yet, or is no longer scheduled/live.',
    }
  }

  const now = new Date().toISOString()
  if (m.round === 'group') {
    await admin
      .from('matches')
      .update({ status: 'completed', resolution: 'no_show_draw', score_a: 0, score_b: 0, completed_at: now, admin_note: reason })
      .eq('id', id)
    if (m.group_id) await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else {
    await admin
      .from('matches')
      .update({ status: 'forfeited', completed_at: now, admin_note: reason })
      .eq('id', id)
    await advanceKnockout(admin, m.tournament_id, m.round)
  }
  await syncMatchEvents(admin, id)
  await refundMatchBets(admin, id)

  const t = firstOf(m.tournament as { slug: string } | { slug: string }[] | null)
  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}

export type ResolveState = { error?: string; success?: boolean; flagged?: number } | undefined

// Manual fallback for the hourly cron — "the system shouldn't fail" per the
// design spec. Scoped to one tournament via the admin matches page. Only
// flags stale matches for review; never resolves anything itself.
export async function triggerResolvePendingMatches(_prev: ResolveState, formData: FormData): Promise<ResolveState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { flagged } = await resolvePendingNoShowMatches(admin, tournamentId)

  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath('/admin/results')
  return { success: true, flagged }
}
