import { getChampion, getRunnerUp, type BracketMatch } from '@/lib/tournaments/bracket'

export interface TournamentResultInput {
  tournamentId: string
  slug: string
  title: string
  prizePool: number
  tournamentEnd: string | null
  finalMatch: BracketMatch | null
}

export interface TournamentResultEntry {
  tournamentId: string
  slug: string
  title: string
  prizePool: number
  date: string | null
  champion: { id: string; name: string }
  runnerUp: { id: string; name: string } | null
}

// Masters/Champions Cup champion + runner-up per completed tournament —
// reuses getChampion/getRunnerUp so the winner rule is never reimplemented.
// Ordered most-recent-first, nulls last (same convention as awards.ts).
export function deriveTournamentResults(inputs: TournamentResultInput[]): TournamentResultEntry[] {
  return inputs
    .flatMap((inp) => {
      if (!inp.finalMatch) return []
      const champion = getChampion([inp.finalMatch])
      if (!champion) return []
      return [
        {
          tournamentId: inp.tournamentId,
          slug: inp.slug,
          title: inp.title,
          prizePool: inp.prizePool,
          date: inp.tournamentEnd,
          champion,
          runnerUp: getRunnerUp([inp.finalMatch]),
        },
      ]
    })
    .sort((a, b) => {
      if (a.date == null) return b.date == null ? 0 : 1
      if (b.date == null) return -1
      return b.date.localeCompare(a.date)
    })
}
