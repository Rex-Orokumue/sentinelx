'use server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { confirmScoreSchema } from './verify-schema'
import { computeGroupStats, collectAdvancers, type GroupMatchResult } from '@/lib/tournaments/results'
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  thirdPlacePair,
  type AdvanceMatch,
} from '@/lib/tournaments/advancement'
import { knockoutRound1 } from '@/lib/tournaments/draw'
import { nextRoundScheduledAt } from '@/lib/tournaments/round-schedule'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'
import { syncMatchEvents } from '@/lib/scoring/apply'
import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import { resultKey } from '@/lib/notifications/keys'
import { notifyNewFixtures } from '@/lib/notifications/fixture-created'
import { creditWallet } from '@/lib/wallet/service'
import { settleMatchBets, refundMatchBets } from '@/lib/betting/settle'
import { revalidateAll } from './revalidate'

export type VerifyState = { error?: string; success?: boolean } | undefined
type Admin = ReturnType<typeof createAdminClient>

function firstStr<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

// Rewrites one group's denormalized standings from its completed matches, and
// nothing else. Split out from recomputeGroupAndMaybeAdvance so callers that
// only want the table refreshed — the admin "Recompute standings" action, and
// a substitution — cannot accidentally trigger knockout generation as a side
// effect. Safe to run at any time: it is a pure function of the matches.
export async function recomputeGroupStats(admin: Admin, groupId: string): Promise<void> {
  const { data: members } = await admin
    .from('group_memberships')
    .select('player_id')
    .eq('group_id', groupId)
  const playerIds = (members ?? []).map((r) => r.player_id)
  const { data: gm } = await admin
    .from('matches')
    .select('player_a_id, player_b_id, score_a, score_b')
    .eq('group_id', groupId)
    .eq('status', 'completed')
  const results: GroupMatchResult[] = (gm ?? [])
    .filter((r) => r.player_a_id && r.player_b_id && r.score_a != null && r.score_b != null)
    .map((r) => ({
      playerAId: r.player_a_id as string,
      playerBId: r.player_b_id as string,
      scoreA: r.score_a as number,
      scoreB: r.score_b as number,
    }))
  for (const s of computeGroupStats(playerIds, results)) {
    await admin
      .from('group_memberships')
      .update({
        points: s.points,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        goals_for: s.goalsFor,
        goals_against: s.goalsAgainst,
      })
      .eq('group_id', groupId)
      .eq('player_id', s.playerId)
  }
}

// Recompute one group's standings, then generate the knockout stage if the group stage is done.
export async function recomputeGroupAndMaybeAdvance(
  admin: Admin,
  tournamentId: string,
  groupId: string,
): Promise<void> {
  await recomputeGroupStats(admin, groupId)

  // Generate the knockout stage once ALL group matches are complete and none exists yet.
  const { count: remaining } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', 'group')
    .neq('status', 'completed')
  if (remaining && remaining > 0) return
  const { count: knockout } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .neq('round', 'group')
  if (knockout && knockout > 0) return

  const { data: groups } = await admin
    .from('groups')
    .select('id')
    .eq('tournament_id', tournamentId)
    .order('name')
  const standingsPerGroup: { playerId: string; advancing: boolean }[][] = []
  for (const g of groups ?? []) {
    const { data: mem } = await admin
      .from('group_memberships')
      .select('player_id, wins, draws, losses, goals_for, goals_against, points')
      .eq('group_id', g.id)
    const rows: MembershipInput[] = (mem ?? []).map((r) => ({
      playerId: r.player_id,
      name: '',
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      goalsFor: r.goals_for,
      goalsAgainst: r.goals_against,
      points: r.points,
    }))
    standingsPerGroup.push(sortStandings(rows))
  }
  const advancers = collectAdvancers(standingsPerGroup)
  if (advancers.length < 2) return
  const { round, matches, byePlayerIds } = knockoutRound1(advancers)
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const rows = [
    ...matches.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
      ...schedule,
    })),
    ...byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: pid,
      player_b_id: null,
      status: 'bye',
      ...schedule,
    })),
  ]
  if (rows.length > 0) {
    const { data: inserted } = await admin
      .from('matches')
      .insert(rows)
      .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
    await notifyNewFixtures(
      admin,
      (inserted ?? []).map((m) => ({
        id: m.id,
        tournamentId,
        playerAId: m.player_a_id as string,
        playerBId: m.player_b_id,
        scheduledAt: m.scheduled_at,
        isFullDay: m.is_full_day,
      })),
    )
  }
}

// Create the next knockout round once the current round is fully resolved.
export async function advanceKnockout(admin: Admin, tournamentId: string, round: string): Promise<void> {
  const { data: roundMatches } = await admin
    .from('matches')
    .select('status, score_a, score_b, player_a_id, player_b_id')
    .eq('tournament_id', tournamentId)
    .eq('round', round)
  const rm = (roundMatches ?? []) as AdvanceMatch[]
  if (!roundResolved(rm)) return
  const nr = nextRoundName(round)
  if (nr === null) return // final: tournament completion handled by the caller
  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', nr)
  if (existing && existing > 0) return

  const byeWinners = rm
    .filter((m) => m.status === 'bye')
    .map((m) => m.player_a_id)
    .filter(Boolean) as string[]
  const matchWinners = rm
    .filter((m) => m.status === 'completed')
    .map((m) => matchWinnerId(m))
    .filter(Boolean) as string[]
  const { pairs, leftover } = pairWinners(byeWinners, matchWinners)
  if (pairs.length === 0 && !leftover) return
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const { data: inserted } = await admin
    .from('matches')
    .insert(
      [
        ...pairs.map(([a, b]) => ({
          tournament_id: tournamentId,
          round: nr,
          group_id: null,
          player_a_id: a,
          player_b_id: b,
          status: 'scheduled',
          ...schedule,
        })),
        ...(leftover
          ? [
              {
                tournament_id: tournamentId,
                round: nr,
                group_id: null,
                player_a_id: leftover,
                player_b_id: null,
                status: 'bye',
                ...schedule,
              },
            ]
          : []),
      ],
    )
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
  await notifyNewFixtures(
    admin,
    (inserted ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )
}

// Create the 3rd place match from the two semifinal losers, once both semis
// are decisively completed. Idempotent — a tournament ends up with at most
// one third_place row, whether it comes from here or from the admin
// manual-credit path (creditThirdPlace, below).
async function createThirdPlaceMatch(admin: Admin, tournamentId: string): Promise<void> {
  const { data: semis } = await admin
    .from('matches')
    .select('status, score_a, score_b, player_a_id, player_b_id')
    .eq('tournament_id', tournamentId)
    .eq('round', 'semi_final')
  const pair = thirdPlacePair((semis ?? []) as AdvanceMatch[])
  if (!pair) return

  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', 'third_place')
  if (existing && existing > 0) return

  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const { data: inserted } = await admin
    .from('matches')
    .insert({
      tournament_id: tournamentId,
      round: 'third_place',
      group_id: null,
      player_a_id: pair[0],
      player_b_id: pair[1],
      status: 'scheduled',
      ...schedule,
    })
    .select('id, player_a_id, player_b_id, scheduled_at, is_full_day')
  await notifyNewFixtures(
    admin,
    (inserted ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )
}

export async function confirmResult(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const ctx = await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }
  const parsed = confirmScoreSchema.safeParse({
    scoreA: formData.get('scoreA'),
    scoreB: formData.get('scoreB'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { scoreA, scoreB } = parsed.data

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, round, group_id, tournament_id, player_a_id, player_b_id, tournament:tournaments(status, slug, prize_pool)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  const isKnockout = m.round !== 'group'
  if (isKnockout && scoreA === scoreB) return { error: 'A knockout match cannot end in a draw.' }

  const { error: upErr } = await admin
    .from('matches')
    // resolution: null clears any prior 'walkover'/'no_show_draw' tag — a
    // normally confirmed result supersedes it. Without this, matchEventsFor
    // (lib/scoring/events.ts) keeps branching on the stale resolution and
    // penalizes both players -10 regardless of the real score just entered.
    .update({
      score_a: scoreA,
      score_b: scoreB,
      status: 'completed',
      resolution: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (upErr) return { error: 'Could not save the result. Please try again.' }

  if (scoreA === scoreB) {
    // Knockout matches can't reach this point in a draw (rejected above) —
    // this only fires for a group-stage draw, a push with no side to
    // redistribute the bet pool to.
    await refundMatchBets(admin, id)
  } else {
    const winningSide = scoreA > scoreB ? 'player_a' : 'player_b'
    await settleMatchBets(admin, id, winningSide)
  }

  await admin
    .from('match_results')
    .update({ status: 'verified', verified: true, verified_by: ctx.userId, verified_at: new Date().toISOString() })
    .eq('match_id', id)

  const t = firstStr(
    m.tournament as
      | { status: string; slug: string; prize_pool: number }
      | { status: string; slug: string; prize_pool: number }[]
      | null,
  )
  const slug = t?.slug ?? ''

  if (!isKnockout && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (m.round === 'semi_final') {
      await createThirdPlaceMatch(admin, m.tournament_id)
    }
    if (m.round === 'final') {
      // Claim the completion atomically — the prize is credited only by the
      // call that actually flipped the tournament to 'completed'. A bracket
      // that somehow lands more than one match in the 'final' round (or a
      // double-confirm) would otherwise pay the full pool out once per match.
      //
      // Explicitly 'final', not "nextRoundName(round) === null" — the
      // third_place round also returns null from nextRoundName (it's
      // deliberately outside ROUND_ORDER's progression chain), so that check
      // would otherwise fire when the bronze match gets confirmed too,
      // wrongly completing the tournament and paying its winner the full pool.
      const { data: claimed } = await admin
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', m.tournament_id)
        .neq('status', 'completed')
        .select('id')

      if (claimed && claimed.length > 0) {
        // Winner-take-all: the final's winner gets the full prize_pool. No
        // placement tiers — a runner-up/3rd-place prize, if ever wanted, goes
        // through the admin manual-credit path (adminCreditWallet), not an
        // automated split.
        const winnerId = matchWinnerId({
          status: 'completed',
          score_a: scoreA,
          score_b: scoreB,
          player_a_id: m.player_a_id,
          player_b_id: m.player_b_id,
        })
        const prizePool = t?.prize_pool ?? 0
        if (winnerId && prizePool > 0) {
          await creditWallet(admin, winnerId, prizePool, 'prize', m.tournament_id)
        }
      }
    }
  }

  await syncMatchEvents(admin, id)

  type NameRef =
    | { display_name: string | null; username: string | null }
    | { display_name: string | null; username: string | null }[]
    | null
  type NdRow = {
    player_a_id: string | null
    player_b_id: string | null
    player_a: NameRef
    player_b: NameRef
    tournament: { title: string } | { title: string }[] | null
  }
  const { data: ndRaw } = await admin
    .from('matches')
    .select(
      'player_a_id, player_b_id, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('id', id)
    .maybeSingle()
  const nd = (ndRaw ?? null) as unknown as NdRow | null
  if (nd) {
    const nameOf = (x: NameRef) => {
      const r = Array.isArray(x) ? x[0] ?? null : x
      return r?.display_name ?? r?.username ?? 'Player'
    }
    const tRef = nd.tournament
    const title = (Array.isArray(tRef) ? tRef[0]?.title : tRef?.title) ?? 'the tournament'
    const a = nameOf(nd.player_a)
    const b = nameOf(nd.player_b)
    for (const pid of [nd.player_a_id, nd.player_b_id]) {
      if (!pid) continue
      await notify({
        type: 'result_confirmed',
        playerId: pid,
        dedupeKey: resultKey(id, pid),
        playerA: a,
        playerB: b,
        scoreA,
        scoreB,
        tournament: title,
      })
      await notifyInApp({
        playerId: pid,
        type: 'result_confirmed',
        title: 'Result confirmed',
        body: `${a} ${scoreA} – ${scoreB} ${b} — confirmed for ${title}.`,
        link: `/matches/${id}`,
      })
    }
  }

  revalidateAll(m.tournament_id, slug, id)
  return { success: true }
}

export async function disputeResult(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!note) return { error: 'Enter a reason for the dispute.' }

  const admin = createAdminClient()
  const { data: m } = await admin
    .from('matches')
    .select('id, tournament_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const { error } = await admin
    .from('matches')
    .update({ status: 'disputed', admin_note: note })
    .eq('id', id)
  if (error) return { error: 'Could not save the dispute.' }
  await admin.from('match_results').update({ status: 'disputed' }).eq('match_id', id)

  await syncMatchEvents(admin, id)

  const t = firstStr(m.tournament as { slug: string } | { slug: string }[] | null)
  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}
