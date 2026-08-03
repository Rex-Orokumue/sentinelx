import { isRankingEligible, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import { categoryStat } from '@/lib/rankings/game-breakdown'
import { getChampion, getThirdPlace, type BracketMatch } from '@/lib/tournaments/bracket'

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

// Picks the top scorer in the given category among eligible players, ties
// broken by wins. Returns null if nobody eligible has scored anything in
// that category — otherwise a category with an active game but zero
// completed matches would silently crown an arbitrary non-player (whoever
// has the most wins) as its award winner.
export function pickCategoryAward(players: PlayerStatsInput[], category: string): PlayerStatsInput | null {
  const eligible = players.filter(isRankingEligible)
  if (eligible.length === 0) return null
  const ranked = [...eligible].sort(
    (a, b) => categoryStat(b.categoryStats, category).scored - categoryStat(a.categoryStats, category).scored || b.wins - a.wins,
  )
  const top = ranked[0]
  return categoryStat(top.categoryStats, category).scored > 0 ? top : null
}

// Kept for existing callers/tests — identical to pickCategoryAward(players, 'football').
export function pickGoldenBoot(players: PlayerStatsInput[]): PlayerStatsInput | null {
  return pickCategoryAward(players, 'football')
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

export interface ThirdPlaceInput {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  tournamentEnd: string | null
  thirdPlaceMatch: BracketMatch | null
}

export interface ThirdPlaceEntry {
  tournamentId: string
  slug: string
  title: string
  gameName: string | null
  date: string | null
  player: { id: string; name: string }
}

// One 3rd place entry per completed tournament with a decided third_place
// match — real (two semifinal losers played it) or admin-credited (a bye,
// single player). getThirdPlace enforces both shapes identically, so the
// winner rule is reused, never reimplemented. Ordered most-recent-first,
// nulls last — same ordering as deriveChampions. Kept as a separate
// function/types rather than generalizing deriveChampions itself, since
// ChampionInput/ChampionEntry are exercised by existing tests and consumers.
export function deriveThirdPlaces(inputs: ThirdPlaceInput[]): ThirdPlaceEntry[] {
  return inputs
    .flatMap((inp) => {
      if (!inp.thirdPlaceMatch) return []
      const w = getThirdPlace([inp.thirdPlaceMatch])
      if (!w) return []
      return [
        {
          tournamentId: inp.tournamentId,
          slug: inp.slug,
          title: inp.title,
          gameName: inp.gameName,
          date: inp.tournamentEnd,
          player: { id: w.id, name: w.name },
        },
      ]
    })
    .sort((a, b) => {
      if (a.date == null) return b.date == null ? 0 : 1
      if (b.date == null) return -1
      return b.date.localeCompare(a.date)
    })
}
