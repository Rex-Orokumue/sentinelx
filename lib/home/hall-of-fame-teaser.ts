import { deriveTournamentResults, type TournamentResultInput } from '@/lib/hall-of-fame/tournament-results'
import type { BracketMatch } from '@/lib/tournaments/bracket'

export interface ChampionsCupTournamentRow {
  id: string
  slug: string
  title: string
  tournament_end: string | null
  prize_pool: number
  gameName: string | null
}

export interface HallOfFameTeaserData {
  slug: string
  title: string
  prizePool: number
  gameName: string | null
  championName: string
}

// Homepage-scoped: same champion-resolution rule the Hall of Fame page uses
// for its Champions Cup section (`deriveTournamentResults`), narrowed to
// "latest completed Champions Cup only". Returns null when there's no
// resolvable champion yet — the teaser section is omitted entirely in that
// case (see HallOfFameTeaser).
export function buildHallOfFameTeaserData(
  tournament: ChampionsCupTournamentRow | null,
  finalMatch: BracketMatch | null,
): HallOfFameTeaserData | null {
  if (!tournament || !finalMatch) return null

  const input: TournamentResultInput = {
    tournamentId: tournament.id,
    slug: tournament.slug,
    title: tournament.title,
    prizePool: tournament.prize_pool,
    tournamentEnd: tournament.tournament_end,
    finalMatch,
  }
  const [result] = deriveTournamentResults([input])
  if (!result) return null

  return {
    slug: result.slug,
    title: result.title,
    prizePool: result.prizePool,
    gameName: tournament.gameName,
    championName: result.champion.name,
  }
}
