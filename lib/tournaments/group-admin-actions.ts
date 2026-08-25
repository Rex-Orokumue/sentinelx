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

async function regenerateGroupMatches(
  admin: Admin,
  tournamentId: string,
  groupIds: string[],
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
      .select('player_id')
      .eq('group_id', groupId)
    const pairs = roundRobinPairs((roster ?? []).map((r) => r.player_id))
    for (const [a, b] of pairs) {
      rows.push({
        tournament_id: tournamentId,
        round: 'group',
        group_id: groupId,
        player_a_id: a,
        player_b_id: b,
        status: 'scheduled',
        ...schedule,
      })
    }
  }
  if (rows.length > 0) {
    const { error: insErr } = await admin.from('matches').insert(rows)
    if (insErr) throw new Error(`Failed to regenerate group matches: ${insErr.message}`)
  }
}

// Manually reassigns a player to a different group and rebuilds round-robin
// matches for both the group they left and the one they joined. Admin-only,
// and only while the bracket is generated but not yet published — the same
// window BracketActions already limits re-rolling and reopening to.
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
    .select('status')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed')
    return { error: 'Groups can only be edited before the bracket is published.' }

  const { data: groups } = await admin.from('groups').select('id').eq('tournament_id', tournamentId)
  const groupIds = (groups ?? []).map((g) => g.id)
  if (!groupIds.includes(toGroupId)) return { error: 'Target group is not part of this tournament.' }

  const { data: membership } = await admin
    .from('group_memberships')
    .select('id, group_id')
    .eq('player_id', playerId)
    .in('group_id', groupIds)
    .maybeSingle()
  if (!membership) return { error: 'Player is not in a group for this tournament.' }
  const fromGroupId = membership.group_id
  if (fromGroupId === toGroupId) return { error: 'Player is already in that group.' }

  const [{ count: fromCount }, { count: toCount }] = await Promise.all([
    admin.from('group_memberships').select('*', { count: 'exact', head: true }).eq('group_id', fromGroupId),
    admin.from('group_memberships').select('*', { count: 'exact', head: true }).eq('group_id', toGroupId),
  ])
  if (!canMoveOutOfGroup(fromCount ?? 0))
    return { error: 'Moving this player would leave their current group with fewer than 2 players.' }
  if (!canReceiveIntoGroup(toCount ?? 0))
    return { error: 'That group already has the maximum of 8 players.' }

  const { error: moveErr } = await admin
    .from('group_memberships')
    .update({ group_id: toGroupId, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, points: 0 })
    .eq('id', membership.id)
  if (moveErr) return { error: `Failed to move player: ${moveErr.message}` }

  try {
    await regenerateGroupMatches(admin, tournamentId, [fromGroupId, toGroupId])
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to regenerate group matches.' }
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  return { success: true }
}
