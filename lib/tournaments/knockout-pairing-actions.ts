'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { loadBracketView } from './bracket-view'
import {
  computePendingKnockoutRound,
  computeRearrangeableKnockoutRound,
  validateAssignment,
  type PairingAssignment,
} from './knockout-pairing'
import { nextRoundScheduledAt } from './round-schedule'
import { notifyNewFixtures } from '@/lib/notifications/fixture-created'
import { SITE_URL } from '@/lib/seo/site'
import { notifyBoth } from '@/lib/notifications/send'
import { rostersForSquads } from './squad-roster'

export type KnockoutPairingState = { error?: string; success?: boolean } | undefined

type EntrantKind = 'solo' | 'squad'

// Mirrors the sideCols/kind pattern in bracket-admin-actions.ts's generate()
// and group-admin-actions.ts — same "exactly one of player/team columns set"
// shape the matches_side_a_kind/matches_side_b_kind CHECK constraints
// enforce. Local to this file (both createKnockoutRound and
// swapKnockoutPairing use it), not shared across files, matching the
// existing convention.
function sideCols(kind: EntrantKind, a: string, b: string | null) {
  return kind === 'squad' ? { team_a_id: a, team_b_id: b } : { player_a_id: a, player_b_id: b }
}

const assignmentSchema = z.object({
  byePlayerIds: z.array(z.string().uuid()),
  matchPairs: z.array(z.tuple([z.string().uuid(), z.string().uuid()])),
})

function parseAssignment(raw: FormDataEntryValue | null): PairingAssignment | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = assignmentSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function revalidate(tournamentId: string, slug: string | null): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}

function groupStageComplete(view: Awaited<ReturnType<typeof loadBracketView>>): boolean {
  return (
    view.hasGroups &&
    view.fixtures.completed.length > 0 &&
    view.fixtures.live.length === 0 &&
    view.fixtures.upcoming.length === 0 &&
    view.fixtures.disputedOrCancelled.length === 0
  )
}

export async function createKnockoutRound(
  _prev: KnockoutPairingState,
  formData: FormData,
): Promise<KnockoutPairingState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const round = String(formData.get('round') ?? '')
  const assignment = parseAssignment(formData.get('assignment'))
  if (!tournamentId || !round) return { error: 'Missing tournament or round.' }
  if (!assignment) return { error: 'Could not read the pairing. Please try again.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('format, slug, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  const kind: EntrantKind = t.entry_unit === 'squad' ? 'squad' : 'solo'

  const view = await loadBracketView(admin, tournamentId, t.format)
  const pending = computePendingKnockoutRound({
    manualPairingEnabled: true,
    hasGroups: view.hasGroups,
    groupStageComplete: groupStageComplete(view),
    standings: view.standings.map((g) => ({
      groupName: g.groupName,
      rows: g.rows.map((r) => ({ playerId: r.playerId, name: r.name, advancing: r.advancing })),
    })),
    knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
  })
  if (!pending) return { error: 'No knockout round is ready to be created right now.' }
  if (pending.round !== round)
    return { error: `The round ready to create is ${pending.label}, not ${round}.` }

  const check = validateAssignment(pending.participants.map((p) => p.id), pending.shape, assignment)
  if (!check.ok) return { error: check.reason }

  // Idempotency: never insert into a round that already has rows.
  const { count: existing } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('round', round)
  if (existing && existing > 0) return { error: 'This round has already been created.' }

  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}
  const rows = [
    ...assignment.matchPairs.map(([a, b]) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      status: 'scheduled',
      ...sideCols(kind, a, b),
      ...schedule,
    })),
    ...assignment.byePlayerIds.map((pid) => ({
      tournament_id: tournamentId,
      round,
      group_id: null,
      status: 'bye',
      ...sideCols(kind, pid, null),
      ...schedule,
    })),
  ]

  const { data: insertedRows, error } = await admin
    .from('matches')
    .insert(rows)
    .select('id, player_a_id, player_b_id, team_a_id, team_b_id, scheduled_at, is_full_day')
  if (error) return { error: 'Could not create the round. Please try again.' }

  await notifyNewFixtures(
    admin,
    (insertedRows ?? []).map((m) => ({
      id: m.id,
      tournamentId,
      playerAId: m.player_a_id as string,
      playerBId: m.player_b_id,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      scheduledAt: m.scheduled_at,
      isFullDay: m.is_full_day,
    })),
  )

  revalidate(tournamentId, t.slug)
  return { success: true }
}

export async function swapKnockoutPairing(
  _prev: KnockoutPairingState,
  formData: FormData,
): Promise<KnockoutPairingState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const round = String(formData.get('round') ?? '')
  const assignment = parseAssignment(formData.get('assignment'))
  if (!tournamentId || !round) return { error: 'Missing tournament or round.' }
  if (!assignment) return { error: 'Could not read the pairing. Please try again.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('format, slug, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  const kind: EntrantKind = t.entry_unit === 'squad' ? 'squad' : 'solo'

  const view = await loadBracketView(admin, tournamentId, t.format)
  const rearrangeable = computeRearrangeableKnockoutRound({
    knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
  })
  if (!rearrangeable || rearrangeable.round !== round)
    return { error: 'This round can no longer be rearranged — results may already be in.' }

  const check = validateAssignment(
    rearrangeable.participants.map((p) => p.id),
    rearrangeable.shape,
    assignment,
  )
  if (!check.ok) return { error: check.reason }

  // Slot -> existing match row id. Pair slots first (matchIdByPairIndex), then
  // bye slots (byeMatchIdByIndex); the pooled ids let a slot flip pair<->bye.
  const rowIds = [...rearrangeable.matchIdByPairIndex, ...rearrangeable.byeMatchIdByIndex]
  type Desired = { id: string; a: string; b: string | null; status: string }
  const desired: Desired[] = [
    ...assignment.matchPairs.map((pair, i) => ({
      id: rowIds[i],
      a: pair[0],
      b: pair[1] as string | null,
      status: 'scheduled',
    })),
    ...assignment.byePlayerIds.map((pid, i) => ({
      id: rowIds[assignment.matchPairs.length + i],
      a: pid,
      b: null as string | null,
      status: 'bye',
    })),
  ]

  const before = new Map<string, { a: string; b: string | null; status: string }>([
    ...rearrangeable.currentAssignment.matchPairs.map(
      (p, i) =>
        [rearrangeable.matchIdByPairIndex[i], { a: p[0], b: p[1] as string | null, status: 'scheduled' }] as const,
    ),
    ...rearrangeable.currentAssignment.byePlayerIds.map(
      (pid, i) =>
        [rearrangeable.byeMatchIdByIndex[i], { a: pid, b: null as string | null, status: 'bye' }] as const,
    ),
  ])

  const changedIds = new Set<string>()
  for (const d of desired) {
    const prev = before.get(d.id)
    if (prev && prev.a === d.a && prev.b === d.b && prev.status === d.status) continue
    const { error } = await admin
      .from('matches')
      .update({ ...sideCols(kind, d.a, d.b), status: d.status })
      .eq('id', d.id)
    if (error) return { error: 'Could not save the new pairing. Please try again.' }
    for (const pid of [d.a, d.b, prev?.a, prev?.b]) if (pid) changedIds.add(pid)
  }

  if (changedIds.size > 0) {
    const ids = Array.from(changedIds)
    const opponentOf = (id: string): string | null => {
      for (const d of desired) {
        if (d.a === id) return d.b
        if (d.b === id) return d.a
      }
      return null
    }
    const link = `/tournaments/${t.slug}/bracket`

    if (kind === 'squad') {
      const { data: squads } = await admin.from('squads').select('id, name').in('id', ids)
      const nameBySquad = new Map((squads ?? []).map((s) => [s.id, s.name]))
      const rosterBySquad = await rostersForSquads(admin, ids)
      for (const sid of ids) {
        const opp = opponentOf(sid)
        for (const pid of rosterBySquad.get(sid) ?? []) {
          await notifyBoth(
            pid,
            {
              type: 'fixture_updated',
              round: rearrangeable.label,
              opponent: opp ? nameBySquad.get(opp) ?? null : null,
            },
            'fixture_assigned',
            { link, url: `${SITE_URL}${link}` },
          )
        }
      }
    } else {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, username, display_name')
        .in('id', ids)
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? p.username ?? 'Player']))
      for (const pid of ids) {
        const opp = opponentOf(pid)
        await notifyBoth(
          pid,
          {
            type: 'fixture_updated',
            round: rearrangeable.label,
            opponent: opp ? nameById.get(opp) ?? null : null,
          },
          'fixture_assigned',
          { link, url: `${SITE_URL}${link}` },
        )
      }
    }
  }

  revalidate(tournamentId, t.slug)
  return { success: true }
}
