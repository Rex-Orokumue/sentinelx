import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// squad_members and squads are both publicly readable (members_public_read /
// the equivalent squads policy — FOR SELECT USING (true)), so every function
// here works identically from a regular request-scoped client or the
// service-role admin client. Widened from the admin-only alias this module
// started with once public pages (Phase 6) needed the same lookups.
type Client = SupabaseClient<Database>

// Every current member of a squad — the team-vs-team match lifecycle's
// single source of "who is on this side" (check-in participation, per-player
// SX Score events, prize splits, no-show resolution). A squad's roster is
// fixed once it reaches 'complete' (spec §3: no substitutes), so this needs
// no point-in-time snapshot — the live squad_members rows ARE the roster for
// every match that squad ever plays.
export async function squadRosterIds(admin: Client, squadId: string): Promise<string[]> {
  const { data } = await admin.from('squad_members').select('player_id').eq('squad_id', squadId)
  return (data ?? []).map((r) => r.player_id as string)
}

// Both sides of a team match at once — the shape every match-lifecycle
// caller (teamMatchEventsFor's caller, the admin review page, prize
// splitting) needs. A null side (should not happen post-generation, since a
// team match always has both sides populated or is a bye with no team side
// at all) returns an empty roster rather than throwing.
export async function matchRosters(
  admin: Client,
  teamAId: string | null,
  teamBId: string | null,
): Promise<{ rosterA: string[]; rosterB: string[] }> {
  const [rosterA, rosterB] = await Promise.all([
    teamAId ? squadRosterIds(admin, teamAId) : Promise.resolve([]),
    teamBId ? squadRosterIds(admin, teamBId) : Promise.resolve([]),
  ])
  return { rosterA, rosterB }
}

// Every roster member of every squad in one tournament, as a player_id ->
// squad_id map. This is the translation season-placement's
// bandsForPlacements/guaranteedBandsForPlacements need: those functions
// compute a placement band per match SIDE (a squad id, for a team
// tournament), but the caller's activePlayerIds list — and everything season
// points/coins/XP/achievements credit — is always keyed by individual
// player. One player belongs to at most one squad per tournament
// (squad_members_one_squad_per_tournament), so this map is unambiguous.
export async function squadIdByPlayerForTournament(admin: Client, tournamentId: string): Promise<Map<string, string>> {
  const { data } = await admin.from('squad_members').select('player_id, squad_id').eq('tournament_id', tournamentId)
  return new Map((data ?? []).map((r) => [r.player_id as string, r.squad_id as string]))
}

// Every current member of several squads at once, batched into one query —
// for a list page (bracket, rankings, Hall of Fame) resolving many matches'
// rosters, not the single-match case matchRosters already covers.
export async function rostersForSquads(client: Client, squadIds: string[]): Promise<Map<string, string[]>> {
  if (squadIds.length === 0) return new Map()
  const { data } = await client.from('squad_members').select('squad_id, player_id').in('squad_id', squadIds)
  const map = new Map<string, string[]>()
  for (const r of data ?? []) {
    const arr = map.get(r.squad_id as string) ?? []
    arr.push(r.player_id as string)
    map.set(r.squad_id as string, arr)
  }
  return map
}
