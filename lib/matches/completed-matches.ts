import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export interface CompletedMatchRow {
  id: string
  round: string
  groupName: string | null
  status: string
  resolution: string | null
  scoreA: number | null
  scoreB: number | null
  playerAName: string
  playerBName: string
  completedAt: string
}

type ProfileRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
function nameOf(p: ProfileRef): string {
  const row = Array.isArray(p) ? p[0] ?? null : p
  return row?.display_name ?? row?.username ?? 'TBD'
}

// All played-out matches for a tournament — completed normally, walkover,
// no-show draw, or a knockout double-forfeit — newest first. Shared by the
// public and admin "Completed Matches" pages.
export async function listCompletedMatches(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
): Promise<CompletedMatchRow[]> {
  const { data } = await supabase
    .from('matches')
    .select(
      'id, round, status, resolution, score_a, score_b, completed_at, ' +
        'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'groups(name)',
    )
    .eq('tournament_id', tournamentId)
    .in('status', ['completed', 'forfeited'])
    .order('completed_at', { ascending: false })

  type GroupRef = { name: string } | { name: string }[] | null
  const groupName = (g: GroupRef) => (Array.isArray(g) ? g[0]?.name ?? null : g?.name ?? null)

  return ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      status: string
      resolution: string | null
      score_a: number | null
      score_b: number | null
      completed_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
      groups: GroupRef
    }
    return {
      id: m.id,
      round: m.round,
      groupName: groupName(m.groups),
      status: m.status,
      resolution: m.resolution,
      scoreA: m.score_a,
      scoreB: m.score_b,
      playerAName: nameOf(m.player_a),
      playerBName: nameOf(m.player_b),
      completedAt: m.completed_at ?? '',
    }
  })
}
