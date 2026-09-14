import type { createClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createClient>

// Whether a signed-in user may act on this match as a participant — check in
// (checkInToMatch) or submit a result (submitMatchResult). Solo: exactly the
// two named players, no query needed. Team: any current member of either
// side's squad roster (spec §7.1/§7.2 — "any roster member, captain or
// otherwise, can submit"). A match with neither a player nor a team side
// populated (should not happen post-generation) has no participants.
export async function isMatchParticipant(
  supabase: Supabase,
  userId: string,
  match: { player_a_id: string | null; player_b_id: string | null; team_a_id: string | null; team_b_id: string | null },
): Promise<boolean> {
  if (match.player_a_id != null || match.player_b_id != null) {
    return userId === match.player_a_id || userId === match.player_b_id
  }
  const squadIds = [match.team_a_id, match.team_b_id].filter((id): id is string => id != null)
  if (squadIds.length === 0) return false
  const { count } = await supabase
    .from('squad_members')
    .select('*', { count: 'exact', head: true })
    .in('squad_id', squadIds)
    .eq('player_id', userId)
  return (count ?? 0) > 0
}
