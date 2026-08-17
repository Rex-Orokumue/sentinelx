import { describe, it, expect } from 'vitest'
import { buildHallOfFameTeaserData, type ChampionsCupTournamentRow } from './hall-of-fame-teaser'
import type { BracketMatch } from '@/lib/tournaments/bracket'

function tournament(over: Partial<ChampionsCupTournamentRow> = {}): ChampionsCupTournamentRow {
  return {
    id: 't1',
    slug: 'champions-cup-s7',
    title: 'SentinelX Champions Cup S7',
    tournament_end: '2026-08-10',
    prize_pool: 200000,
    gameName: 'Dream League Soccer',
    ...over,
  }
}

function finalMatch(over: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 'm1',
    round: 'final',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 3,
    score_b: 1,
    scheduled_at: null,
    is_full_day: false,
    playerA: { id: 'p1', name: 'Akintunde_K' },
    playerB: { id: 'p2', name: 'DavidEsports' },
    ...over,
  }
}

describe('buildHallOfFameTeaserData', () => {
  it('returns the champion when a completed final has a winner', () => {
    const result = buildHallOfFameTeaserData(tournament(), finalMatch())
    expect(result).toEqual({
      slug: 'champions-cup-s7',
      title: 'SentinelX Champions Cup S7',
      prizePool: 200000,
      gameName: 'Dream League Soccer',
      championName: 'Akintunde_K',
    })
  })

  it('returns null when there is no tournament', () => {
    expect(buildHallOfFameTeaserData(null, finalMatch())).toBeNull()
  })

  it('returns null when there is no final match yet', () => {
    expect(buildHallOfFameTeaserData(tournament(), null)).toBeNull()
  })

  it('returns null when the final is a tie (no resolvable winner)', () => {
    expect(buildHallOfFameTeaserData(tournament(), finalMatch({ score_a: 2, score_b: 2 }))).toBeNull()
  })
})
