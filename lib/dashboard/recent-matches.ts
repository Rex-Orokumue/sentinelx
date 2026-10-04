import { isMySide } from '@/lib/matches/sides'

export interface RawRecentMatchRow {
  id: string
  player_a_id: string | null
  player_b_id: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  score_a: number | null
  score_b: number | null
  updated_at: string | null
  opponentName: string
  opponentUsername: string | null
  tournamentTitle: string
}

export interface RecentMatchRow {
  id: string
  outcome: 'win' | 'loss' | 'draw'
  myScore: number
  opponentScore: number
  opponentName: string
  opponentUsername: string | null
  tournamentTitle: string
  updatedAt: string | null
}

// Section 6 "Recent Matches" — spec §2. Rows without a decided score
// (e.g. a still-pending admin ruling) are skipped rather than guessed at.
export function mapRecentMatches(
  rows: RawRecentMatchRow[],
  myPlayerId: string,
  mySquadIds: string[] = [],
): RecentMatchRow[] {
  return rows.flatMap((r) => {
    if (r.score_a == null || r.score_b == null) return []
    const isA =
      isMySide(
        { player_a_id: r.player_a_id, player_b_id: r.player_b_id, team_a_id: r.team_a_id ?? null, team_b_id: r.team_b_id ?? null },
        myPlayerId,
        mySquadIds,
      ) === 'a'
    const myScore = isA ? r.score_a : r.score_b
    const opponentScore = isA ? r.score_b : r.score_a
    const outcome = myScore > opponentScore ? 'win' : myScore < opponentScore ? 'loss' : 'draw'
    return [
      {
        id: r.id,
        outcome,
        myScore,
        opponentScore,
        opponentName: r.opponentName,
        opponentUsername: r.opponentUsername,
        tournamentTitle: r.tournamentTitle,
        updatedAt: r.updated_at,
      },
    ]
  })
}
