'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import type { Database } from '@/lib/supabase/types'
import { roundRobinPairs, canMoveOutOfGroup, canReceiveIntoGroup } from './draw'
import { nextRoundScheduledAt } from './round-schedule'

export type MoveGroupState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>
type MatchInsert = Database['public']['Tables']['matches']['Insert']
type EntrantKind = 'solo' | 'squad'

// Mirrors the sideCols/memberCol pair in bracket-admin-actions.ts's generate()
// and the isTeamGroup branch in verify-actions.ts's recomputeGroupStats — same
// "exactly one of the player/team columns is set" shape the DB enforces
// (matches_side_a_kind/matches_side_b_kind, group_memberships_kind CHECK
// constraints). Kept local to this file rather than shared, matching how
// those two already do it.
function sideCols(
  kind: EntrantKind,
  a: string,
  b: string | null,
): Pick<MatchInsert, 'player_a_id' | 'player_b_id'> | Pick<MatchInsert, 'team_a_id' | 'team_b_id'> {
  return kind === 'squad' ? { team_a_id: a, team_b_id: b } : { player_a_id: a, player_b_id: b }
}

async function regenerateGroupMatches(
  admin: Admin,
  tournamentId: string,
  groupIds: string[],
  kind: EntrantKind,
): Promise<void> {
  // Both affected groups' round-robin matches are torn down and rebuilt from
  // the post-move rosters. Safe because this only runs while the tournament
  // is registration_closed — group-stage matches have no results yet.
  const { error: delErr } = await admin
    .from('matches')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('round', 'group')
    .in('group_id', groupIds)
  if (delErr) throw new Error(`Failed to clear group matches: ${delErr.message}`)

  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}

  const rows: MatchInsert[] = []
  for (const groupId of groupIds) {
    const { data: roster } = await admin
      .from('group_memberships')
      .select('player_id, team_id')
      .eq('group_id', groupId)
    const rosterIds = (roster ?? [])
      .map((r) => (kind === 'squad' ? r.team_id : r.player_id))
      .filter((id): id is string => id != null)
    const pairs = roundRobinPairs(rosterIds)
    for (const [a, b] of pairs) {
      rows.push({
        tournament_id: tournamentId,
        round: 'group',
        group_id: groupId,
        status: 'scheduled',
        ...sideCols(kind, a, b),
        ...schedule,
      })
    }
  }
  if (rows.length > 0) {
    const { error: insErr } = await admin.from('matches').insert(rows)
    if (insErr) throw new Error(`Failed to regenerate group matches: ${insErr.message}`)
  }
}

// Manually reassigns a player — or, for a team tournament, their whole squad —
// to a different group and rebuilds round-robin matches for both the group
// they left and the one they joined. Admin-only, and only while the bracket
// is generated but not yet published — the same window BracketActions already
// limits re-rolling and reopening to.
//
// group_memberships has exactly one row per squad for entry_unit='squad'
// (never one per roster player — group_memberships_kind), so "move a player"
// can only ever mean "move their squad's group placement." The `playerId`
// form field carries a squad id in that case: StandingRow.playerId already
// resolves to the squad id via bracket-view.ts's sideRef() (Phase 6a), so the
// admin bracket UI is already sending the right id — this action just needs
// to read/write the right column.
export async function movePlayerToGroup(
  _prev: MoveGroupState,
  formData: FormData,
): Promise<MoveGroupState> {
  await requireStaff()
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const toGroupId = String(formData.get('toGroupId') ?? '')
  if (!tournamentId || !playerId || !toGroupId) return { error: 'Missing move details.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('status, entry_unit')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed')
    return { error: 'Groups can only be edited before the bracket is published.' }
  const kind: EntrantKind = t.entry_unit === 'squad' ? 'squad' : 'solo'
  const noun = kind === 'squad' ? 'squad' : 'player'

  const { data: groups } = await admin.from('groups').select('id').eq('tournament_id', tournamentId)
  const groupIds = (groups ?? []).map((g) => g.id)
  if (!groupIds.includes(toGroupId)) return { error: 'Target group is not part of this tournament.' }

  const membershipQuery = admin.from('group_memberships').select('id, group_id').in('group_id', groupIds)
  const { data: membership } = await (kind === 'squad'
    ? membershipQuery.eq('team_id', playerId)
    : membershipQuery.eq('player_id', playerId)
  ).maybeSingle()
  if (!membership) return { error: `That ${noun} is not in a group for this tournament.` }
  const fromGroupId = membership.group_id
  if (fromGroupId === toGroupId) return { error: `That ${noun} is already in that group.` }

  const [{ count: fromCount }, { count: toCount }] = await Promise.all([
    admin.from('group_memberships').select('*', { count: 'exact', head: true }).eq('group_id', fromGroupId),
    admin.from('group_memberships').select('*', { count: 'exact', head: true }).eq('group_id', toGroupId),
  ])
  if (!canMoveOutOfGroup(fromCount ?? 0))
    return { error: `Moving this ${noun} would leave their current group with fewer than 2 ${noun}s.` }
  if (!canReceiveIntoGroup(toCount ?? 0))
    return { error: `That group already has the maximum of 8 ${noun}s.` }

  const { error: moveErr } = await admin
    .from('group_memberships')
    .update({ group_id: toGroupId, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0 })
    .eq('id', membership.id)
  if (moveErr) return { error: `Failed to move ${noun}: ${moveErr.message}` }

  try {
    await regenerateGroupMatches(admin, tournamentId, [fromGroupId, toGroupId], kind)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to regenerate group matches.' }
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true }
}
