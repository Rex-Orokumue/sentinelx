'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { confirmScoreSchema } from './verify-schema'
import { computeGroupStats, collectAdvancers, type GroupMatchResult } from '@/lib/tournaments/results'
import {
  matchWinnerId,
  roundResolved,
  pairWinners,
  nextRoundName,
  type AdvanceMatch,
} from '@/lib/tournaments/advancement'
import { knockoutRound1 } from '@/lib/tournaments/draw'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'

export type VerifyState = { error?: string; success?: boolean } | undefined
type Admin = ReturnType<typeof createAdminClient>

function firstStr<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

function revalidateAll(tournamentId: string, slug: string, matchId: string): void {
  revalidatePath('/admin/results')
  revalidatePath(`/admin/matches/${matchId}/review`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/matches/${matchId}`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}

// Recompute one group's standings, then generate the knockout stage if the group stage is done.
async function recomputeGroupAndMaybeAdvance(
  admin: Admin,
  tournamentId: string,
  groupId: string,
): Promise<void> {
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
  const rows = [
    ...matches.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
    })),
    ...byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      player_a_id: pid,
      player_b_id: null,
      status: 'bye',
    })),
  ]
  if (rows.length > 0) await admin.from('matches').insert(rows)
}

// Create the next knockout round once the current round is fully resolved.
async function advanceKnockout(admin: Admin, tournamentId: string, round: string): Promise<void> {
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
  const pairs = pairWinners(byeWinners, matchWinners)
  if (pairs.length === 0) return
  await admin.from('matches').insert(
    pairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round: nr,
      group_id: null,
      player_a_id: a,
      player_b_id: b,
      status: 'scheduled',
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
    .select('id, round, group_id, tournament_id, tournament:tournaments(status, slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  const isKnockout = m.round !== 'group'
  if (isKnockout && scoreA === scoreB) return { error: 'A knockout match cannot end in a draw.' }

  const { error: upErr } = await admin
    .from('matches')
    .update({ score_a: scoreA, score_b: scoreB, status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
  if (upErr) return { error: 'Could not save the result. Please try again.' }
  await admin
    .from('match_results')
    .update({ status: 'verified', verified: true, verified_by: ctx.userId, verified_at: new Date().toISOString() })
    .eq('match_id', id)

  const t = firstStr(m.tournament as { status: string; slug: string } | { status: string; slug: string }[] | null)
  const slug = t?.slug ?? ''

  if (!isKnockout && m.group_id) {
    await recomputeGroupAndMaybeAdvance(admin, m.tournament_id, m.group_id)
  } else if (isKnockout) {
    await advanceKnockout(admin, m.tournament_id, m.round)
    if (nextRoundName(m.round) === null) {
      await admin.from('tournaments').update({ status: 'completed' }).eq('id', m.tournament_id)
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

  const t = firstStr(m.tournament as { slug: string } | { slug: string }[] | null)
  revalidateAll(m.tournament_id, t?.slug ?? '', id)
  return { success: true }
}
