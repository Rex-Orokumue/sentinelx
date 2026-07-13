import { isRankingEligible, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { getChampion, type BracketMatch } from '@/lib/tournaments/bracket'

function winRate(p: PlayerStatsInput): number {
  return p.totalMatches > 0 ? p.wins / p.totalMatches : 0
}

// Most Valuable Player: highest Sentinel Score among eligible players. Ties break by
// wins then win rate — so at launch, when every score is the default 70, MVP resolves
// to most wins with no special-case code.
export function pickMVP(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) =>
      b.sentinelScore - a.sentinelScore ||
      b.wins - a.wins ||
      winRate(b) - winRate(a),
  )[0]
}

// Golden Boot: most FOOTBALL-scoped goals scored among eligible players (not
// the cumulative goalsScored — see PlayerStatsInput's doc comment), ties
// broken by wins.
export function pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  return [...eligible].sort(
    (a, b) => b.footballGoalsScored - a.footballGoalsScored || b.wins - a.wins,
  )[0]
}

export interface ChampionInput {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  tournamentEnd: string | null
  finalMatch: BracketMatch | null
}

export interface ChampionEntry {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  champion: { id: string; name: string }
}

// One champion per completed tournament with a completed, decisive final.
// getChampion enforces round='final' + status='completed' and guards draws/null scores,
// so the winner rule is reused, never reimplemented. Ordered most-recent-first, nulls last.
export function deriveChampions(inputs: ChampionInput[]): ChampionEntry[] {
  return inputs
    .flatMap((inp) => {
      if (!inp.finalMatch) return []
      const w = getChampion([inp.finalMatch])
      if (!w) return []
      return [
        {
          tournamentId: inp.tournamentId,
          slug: inp.slug,
          title: inp.title,
          gameName: inp.gameName,
          date: inp.tournamentEnd,
          champion: { id: w.id, name: w.name },
        },
      ]
    })
    .sort((a, b) => {
      if (a.date == null) return b.date == null ? 0 : 1
      if (b.date == null) return -1
      return b.date.localeCompare(a.date)
    })
}
