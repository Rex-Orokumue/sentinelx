import type { createAdminClient } from '@/lib/supabase/admin'
import { sortPointsStandings, type PointsStandingRow, type StageResultInput } from './points-standings'

type Admin = ReturnType<typeof createAdminClient>

/** Only the fields standings actually need, so callers can pass any stage row. */
export interface StageRef {
  id: string
  advance_count: number
}

// A stage's running standings, built only from CONFIRMED results. A pending
// submission is one player's unverified claim and must not move anyone up the
// table, let alone decide who advances.
//
// Lives in a plain module rather than beside the actions that use it: every
// export from a 'use server' file becomes a client-callable action, and this
// takes a Supabase client, which is not serializable.
export async function stageStanding(admin: Admin, stage: StageRef): Promise<PointsStandingRow[]> {
  const { data: lobbies } = await admin
    .from('tournament_lobbies')
    .select('id, round_no')
    .eq('stage_id', stage.id)
  const lobbyRows = (lobbies ?? []) as { id: string; round_no: number }[]
  if (lobbyRows.length === 0) return []

  const lobbyIds = lobbyRows.map((l) => l.id)
  const roundByLobby = new Map(lobbyRows.map((l) => [l.id, l.round_no]))

  const [{ data: entrantRows }, { data: resultRows }] = await Promise.all([
    admin
      .from('lobby_entrants')
      .select('entrant_id, tournament_entrants(id, display_name)')
      .in('lobby_id', lobbyIds),
    admin
      .from('lobby_results')
      .select('lobby_id, entrant_id, placement, kills, placement_points, kill_points')
      .in('lobby_id', lobbyIds)
      .eq('status', 'confirmed'),
  ])

  // One row per entrant even though they appear once per round they played in.
  const entrants = new Map<string, { id: string; displayName: string }>()
  for (const raw of (entrantRows ?? []) as unknown[]) {
    const r = raw as {
      entrant_id: string
      tournament_entrants: { id: string; display_name: string } | { id: string; display_name: string }[] | null
    }
    const ref = Array.isArray(r.tournament_entrants) ? r.tournament_entrants[0] : r.tournament_entrants
    if (!entrants.has(r.entrant_id)) {
      entrants.set(r.entrant_id, { id: r.entrant_id, displayName: ref?.display_name ?? 'Entrant' })
    }
  }

  const results: StageResultInput[] = ((resultRows ?? []) as unknown[]).map((raw) => {
    const r = raw as {
      lobby_id: string
      entrant_id: string
      placement: number
      kills: number
      placement_points: number
      kill_points: number
    }
    return {
      entrantId: r.entrant_id,
      roundNo: roundByLobby.get(r.lobby_id) ?? 1,
      placement: r.placement,
      kills: r.kills,
      placementPoints: r.placement_points,
      killPoints: r.kill_points,
    }
  })

  return sortPointsStandings(Array.from(entrants.values()), results, stage.advance_count)
}
