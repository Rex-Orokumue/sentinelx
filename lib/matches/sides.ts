import type { createClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createClient>
type One<T> = T | T[] | null | undefined

export type ProfileRef = One<{ id?: string; username: string | null; display_name: string | null; country?: string | null }>
export type SquadRef = One<{ id?: string; name: string; captain_id?: string }>

// Select fragment for both sides of a match. Exactly one of player/squad is
// populated per side (matches_side_a_kind / matches_side_b_kind CHECKs), so a
// caller reads whichever is non-null via sideName().
export const MATCH_SIDES_SELECT =
  'player_a:profiles!matches_player_a_id_fkey(id, username, display_name, country), ' +
  'player_b:profiles!matches_player_b_id_fkey(id, username, display_name, country), ' +
  'team_a:squads!matches_team_a_id_fkey(id, name, captain_id), ' +
  'team_b:squads!matches_team_b_id_fkey(id, name, captain_id)'

function one<T>(v: One<T>): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null
}

export function sideName(player: ProfileRef, squad: SquadRef, fallback = 'TBD'): string {
  const s = one(squad)
  if (s) return s.name
  const p = one(player)
  return p?.display_name ?? p?.username ?? fallback
}

// PostgREST `.or()` filter for "matches this user plays in": as a solo player,
// or as a member of any of their squads. With no squads it is the solo clause
// alone — `team_a_id.in.()` would be a malformed filter.
export function myMatchesFilter(userId: string, squadIds: string[]): string {
  const solo = `player_a_id.eq.${userId},player_b_id.eq.${userId}`
  if (squadIds.length === 0) return solo
  const list = squadIds.join(',')
  return `${solo},team_a_id.in.(${list}),team_b_id.in.(${list})`
}

export async function getMySquadIds(supabase: Supabase, userId: string): Promise<string[]> {
  const { data } = await supabase.from('squad_members').select('squad_id').eq('player_id', userId)
  return (data ?? []).map((r) => r.squad_id as string)
}

type MatchIds = {
  player_a_id: string | null
  player_b_id: string | null
  team_a_id: string | null
  team_b_id: string | null
}

export function isMySide(m: MatchIds, userId: string, squadIds: string[]): 'a' | 'b' | null {
  if (m.player_a_id === userId || (m.team_a_id != null && squadIds.includes(m.team_a_id))) return 'a'
  if (m.player_b_id === userId || (m.team_b_id != null && squadIds.includes(m.team_b_id))) return 'b'
  return null
}

// The id that stands for the user on this match: their own id in a solo match,
// their squad's id in a squad match. This is what advancement/status code
// compares against matchWinnerId().
export function mySideId(m: MatchIds, userId: string, squadIds: string[]): string | null {
  const side = isMySide(m, userId, squadIds)
  if (side === 'a') return m.player_a_id ?? m.team_a_id
  if (side === 'b') return m.player_b_id ?? m.team_b_id
  return null
}

type MatchSides = MatchIds & {
  player_a: ProfileRef
  player_b: ProfileRef
  team_a: SquadRef
  team_b: SquadRef
}

// The side that isn't the user's. `playerId` is set for a solo opponent,
// `squadId` for a squad one; both are null when that side is still TBD.
// `contactPlayerId` is who to reach out to: the solo player, or the squad's
// captain (a squad has no single WhatsApp number of its own).
export function pickOpponent(
  m: MatchSides,
  userId: string,
  squadIds: string[],
): { name: string; playerId: string | null; squadId: string | null; contactPlayerId: string | null } {
  const mine = isMySide(m, userId, squadIds)
  const oppIsA = mine === 'b'
  const player = oppIsA ? m.player_a : m.player_b
  const squad = oppIsA ? m.team_a : m.team_b
  const playerId = oppIsA ? m.player_a_id : m.player_b_id
  const squadRow = Array.isArray(squad) ? squad[0] ?? null : squad ?? null
  return {
    name: sideName(player, squad),
    playerId,
    squadId: oppIsA ? m.team_a_id : m.team_b_id,
    contactPlayerId: playerId ?? squadRow?.captain_id ?? null,
  }
}
