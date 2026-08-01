import { describe, it, expect } from 'vitest'
import {
  computeTournamentStatus,
  type TournamentStatusInput,
  type KnockoutMatchInput,
} from './tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'

function baseInput(over: Partial<TournamentStatusInput> = {}): TournamentStatusInput {
  return {
    tournamentId: 't1',
    tournamentTitle: 'DLS Cup',
    tournamentSlug: 'dls-cup',
    tournamentStatus: 'active',
    groupId: null,
    groupComplete: false,
    groupStandings: [],
    knockoutMatches: [],
    ...over,
  }
}

function knockoutMatch(over: Partial<KnockoutMatchInput>): KnockoutMatchInput {
  return {
    round: 'round_of_16',
    status: 'completed',
    score_a: 1,
    score_b: 0,
    player_a_id: 'me',
    player_b_id: 'opp',
    ...over,
  }
}

function membership(over: Partial<MembershipInput> & { playerId: string }): MembershipInput {
  return { name: '', wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, ...over }
}

describe('computeTournamentStatus', () => {
  it('returns null once the tournament has completed', () => {
    expect(
      computeTournamentStatus(
        'me',
        baseInput({
          tournamentStatus: 'completed',
          groupId: 'g1',
          groupComplete: true,
          groupStandings: [membership({ playerId: 'me', points: 9 })],
        }),
      ),
    ).toBeNull()
  })

  it('returns null with no matches and no group', () => {
    expect(computeTournamentStatus('me', baseInput())).toBeNull()
  })

  it('returns null while the group is still incomplete', () => {
    expect(
      computeTournamentStatus(
        'me',
        baseInput({ groupId: 'g1', groupComplete: false, groupStandings: [membership({ playerId: 'me', points: 3 })] }),
      ),
    ).toBeNull()
  })

  it('qualifies a top-2 finisher once the group is complete', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        groupId: 'g1',
        groupComplete: true,
        groupStandings: [
          membership({ playerId: 'me', points: 9 }),
          membership({ playerId: 'b', points: 6 }),
          membership({ playerId: 'c', points: 3 }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'knockout stage',
      awaitingOpponent: true,
    })
  })

  it('eliminates a finisher outside the top 2', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        groupId: 'g1',
        groupComplete: true,
        groupStandings: [
          membership({ playerId: 'a', points: 9 }),
          membership({ playerId: 'b', points: 6 }),
          membership({ playerId: 'me', points: 3 }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'eliminated',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'group',
    })
  })

  it('qualifies with a real opponent already scheduled', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [knockoutMatch({ status: 'scheduled', player_a_id: 'me', score_a: null, score_b: null })],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
      awaitingOpponent: false,
    })
  })

  it('treats a live match the same as scheduled', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [knockoutMatch({ status: 'live', player_a_id: 'me', score_a: null, score_b: null })],
      }),
    )
    expect(result).toMatchObject({ kind: 'qualified', awaitingOpponent: false })
  })

  it('qualifies a bye with no opponent assigned', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ status: 'bye', player_a_id: 'me', player_b_id: null, score_a: null, score_b: null }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
      awaitingOpponent: true,
    })
  })

  it('qualifies a winner even before the next round is generated', () => {
    // Real production case: Codexempire beat Cristiano 2-0 in round_of_16 while
    // 6 other round_of_16 matches were still scheduled, so no quarter_final row
    // existed for them yet. advanceKnockout waits for the whole round to resolve.
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ round: 'round_of_16', status: 'completed', player_a_id: 'me', player_b_id: 'opp', score_a: 2, score_b: 0 }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'quarter_final',
      awaitingOpponent: true,
    })
  })

  it('eliminates a knockout loser', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [knockoutMatch({ player_a_id: 'opp', player_b_id: 'me', score_a: 4, score_b: 1 })],
      }),
    )
    expect(result).toEqual({
      kind: 'eliminated',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
    })
  })

  it('eliminates both players on a forfeited match', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({ knockoutMatches: [knockoutMatch({ status: 'forfeited', score_a: null, score_b: null })] }),
    )
    expect(result).toEqual({
      kind: 'eliminated',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'round_of_16',
    })
  })

  it('returns null for winning the final', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ round: 'final', player_a_id: 'me', player_b_id: 'opp', score_a: 3, score_b: 1 }),
        ],
      }),
    )
    expect(result).toBeNull()
  })

  it('picks the furthest round when the player has two knockout rows', () => {
    const result = computeTournamentStatus(
      'me',
      baseInput({
        knockoutMatches: [
          knockoutMatch({ round: 'round_of_16', status: 'completed', player_a_id: 'me', player_b_id: 'opp', score_a: 2, score_b: 0 }),
          knockoutMatch({ round: 'quarter_final', status: 'scheduled', player_a_id: 'me', player_b_id: 'opp2', score_a: null, score_b: null }),
        ],
      }),
    )
    expect(result).toEqual({
      kind: 'qualified',
      tournamentTitle: 'DLS Cup',
      tournamentSlug: 'dls-cup',
      round: 'quarter_final',
      awaitingOpponent: false,
    })
  })
})
