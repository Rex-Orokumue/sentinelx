import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { sortStandings, type MembershipInput, type StandingRow } from './standings'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  type BracketMatch,
} from './bracket'

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null
function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

export interface BracketView {
  standings: { groupName: string; rows: StandingRow[] }[]
  fixtures: ReturnType<typeof splitFixturesByState>
  rounds: ReturnType<typeof orderKnockoutRounds>
  champion: { id: string; name: string } | null
  hasGroups: boolean
  hasKnockout: boolean
}

// Loads and shapes a tournament's groups, standings, and matches for the bracket
// components. Shared by the public bracket page and the admin bracket page.
export async function loadBracketView(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
): Promise<BracketView> {
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tournament_id', tournamentId)
    .order('name')

  const groupIds = (groups ?? []).map((g) => g.id)
  const groupNameById = new Map((groups ?? []).map((g) => [g.id, g.name]))

  const [membershipsRes, matchesRes, regsRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('group_memberships')
          .select(
            'group_id, player_id, wins, draws, losses, goals_for, goals_against, points, profiles(username, display_name)',
          )
          .in('group_id', groupIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', tournamentId),
    supabase.from('tournament_registrations').select('player_id, reg_club_name').eq('tournament_id', tournamentId),
  ])

  const clubNameByPlayer = new Map(
    ((regsRes.data as { player_id: string; reg_club_name: string | null }[] | null) ?? []).map((r) => [
      r.player_id,
      r.reg_club_name,
    ]),
  )

  const allMatches: BracketMatch[] = ((matchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      group_id: string | null
      status: string
      score_a: number | null
      score_b: number | null
      scheduled_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    return {
      id: m.id,
      round: m.round,
      group_id: m.group_id,
      groupName: m.group_id ? groupNameById.get(m.group_id) ?? null : null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: m.scheduled_at,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    }
  })

  const standings = (groups ?? []).map((g) => {
    const rows = ((membershipsRes.data as unknown[] | null) ?? [])
      .filter((raw) => (raw as { group_id: string }).group_id === g.id)
      .map((raw): MembershipInput => {
        const gm = raw as {
          player_id: string
          wins: number
          draws: number
          losses: number
          goals_for: number
          goals_against: number
          points: number
          profiles: ProfileRef
        }
        return {
          playerId: gm.player_id,
          name: nameOf(gm.profiles),
          clubName: clubNameByPlayer.get(gm.player_id) ?? null,
          wins: gm.wins,
          draws: gm.draws,
          losses: gm.losses,
          goalsFor: gm.goals_for,
          goalsAgainst: gm.goals_against,
          points: gm.points,
        }
      })
    return { groupName: g.name, rows: sortStandings(rows) }
  })

  const groupMatches = allMatches.filter((m) => m.group_id != null)
  const knockoutMatches = allMatches.filter((m) => m.round !== 'group')
  const rounds = orderKnockoutRounds(knockoutMatches)

  return {
    standings,
    fixtures: splitFixturesByState(groupMatches),
    rounds,
    champion: getChampion(allMatches),
    hasGroups: (groups ?? []).length > 0,
    hasKnockout: rounds.length > 0,
  }
}
