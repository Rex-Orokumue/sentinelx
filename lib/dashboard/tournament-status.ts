import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'
import { matchWinnerId, nextRoundName, type AdvanceMatch } from '@/lib/tournaments/advancement'
import { ROUND_ORDER } from '@/lib/tournaments/bracket'

export interface KnockoutMatchInput extends AdvanceMatch {
  round: string
}

export interface TournamentStatusInput {
  tournamentId: string
  tournamentTitle: string
  tournamentSlug: string
  tournamentStatus: string
  groupId: string | null
  groupComplete: boolean
  groupStandings: MembershipInput[]
  knockoutMatches: KnockoutMatchInput[]
}

export type TournamentBanner =
  | {
      kind: 'qualified'
      tournamentTitle: string
      tournamentSlug: string
      round: string
      // No fixture card exists yet for this round (a bye, or the rest of the
      // previous round hasn't resolved) — the banner is their only signal.
      awaitingOpponent: boolean
    }
  | { kind: 'eliminated'; tournamentTitle: string; tournamentSlug: string; round: string }
  | null

function roundIndex(round: string): number {
  return ROUND_ORDER.indexOf(round as (typeof ROUND_ORDER)[number])
}

function latestKnockoutMatch(matches: KnockoutMatchInput[]): KnockoutMatchInput | null {
  if (matches.length === 0) return null
  return matches.reduce((latest, m) => (roundIndex(m.round) > roundIndex(latest.round) ? m : latest))
}

export function computeTournamentStatus(
  playerId: string,
  input: TournamentStatusInput,
): TournamentBanner {
  // A tournament that already finished shouldn't keep telling a player they
  // were eliminated or qualified weeks later — final placements live on the
  // bracket / Hall of Fame pages by then.
  if (input.tournamentStatus === 'completed') return null

  const latest = latestKnockoutMatch(input.knockoutMatches)
  if (latest) {
    const base = { tournamentTitle: input.tournamentTitle, tournamentSlug: input.tournamentSlug }

    if (latest.status === 'bye') {
      return { kind: 'qualified', ...base, round: latest.round, awaitingOpponent: true }
    }
    if (latest.status === 'scheduled' || latest.status === 'live') {
      return { kind: 'qualified', ...base, round: latest.round, awaitingOpponent: false }
    }
    if (latest.status === 'forfeited') {
      return { kind: 'eliminated', ...base, round: latest.round }
    }
    if (latest.status === 'completed') {
      if (matchWinnerId(latest) === playerId) {
        const next = nextRoundName(latest.round)
        if (next === null) return null // won the final — champion messaging is out of scope
        return { kind: 'qualified', ...base, round: next, awaitingOpponent: true }
      }
      return { kind: 'eliminated', ...base, round: latest.round }
    }
    return null
  }

  if (input.groupId === null) return null
  if (!input.groupComplete) return null

  const row = sortStandings(input.groupStandings).find((r) => r.playerId === playerId)
  if (!row) return null

  const base = { tournamentTitle: input.tournamentTitle, tournamentSlug: input.tournamentSlug }
  return row.advancing
    ? { kind: 'qualified', ...base, round: 'knockout stage', awaitingOpponent: true }
    : { kind: 'eliminated', ...base, round: 'group' }
}
