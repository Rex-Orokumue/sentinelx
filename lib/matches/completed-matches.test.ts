import { describe, it, expect } from 'vitest'
import { groupCompletedMatchesByDate, toCompletedMatchRow, type CompletedMatchRow } from './completed-matches'

function match(over: Partial<CompletedMatchRow> & { id: string }): CompletedMatchRow {
  return {
    round: 'group',
    groupName: 'Group A',
    status: 'completed',
    resolution: null,
    scoreA: 3,
    scoreB: 1,
    playerAName: 'A',
    playerBName: 'B',
    scheduledAt: null,
    isFullDay: false,
    ...over,
  }
}

describe('groupCompletedMatchesByDate', () => {
  it('groups by WAT calendar date, most recent first, Date TBD last', () => {
    const groups = groupCompletedMatchesByDate([
      match({ id: 'tbd', scheduledAt: null }),
      match({ id: 'a', scheduledAt: '2026-08-01T10:00:00Z' }),
      match({ id: 'b', scheduledAt: '2026-08-02T09:00:00Z' }),
      match({ id: 'c', scheduledAt: '2026-08-02T18:00:00Z' }),
    ])
    expect(groups.map((g) => g.dateLabel)).toEqual(['2 Aug 2026', '1 Aug 2026', 'Date TBD'])
    expect(groups[0].matches.map((m) => m.id)).toEqual(['b', 'c'])
    expect(groups[1].matches.map((m) => m.id)).toEqual(['a'])
    expect(groups[2].matches.map((m) => m.id)).toEqual(['tbd'])
    expect(groups[0].dateKey).toBe('2026-08-02')
    expect(groups[2].dateKey).toBe('')
  })

  it('returns no groups for an empty list', () => {
    expect(groupCompletedMatchesByDate([])).toEqual([])
  })
})

describe('toCompletedMatchRow', () => {
  const base = {
    id: 'm1', round: 'final', status: 'completed', resolution: null, score_a: 2, score_b: 1,
    scheduled_at: null, is_full_day: false, groups: null,
    player_a: null, player_b: null, team_a: null, team_b: null,
  }
  it('names a squad match by its squads, not TBD', () => {
    const row = toCompletedMatchRow({ ...base, team_a: { name: 'Squad 2' }, team_b: [{ name: 'Squad 1' }] })
    expect(row.playerAName).toBe('Squad 2')
    expect(row.playerBName).toBe('Squad 1')
  })
  it('keeps solo player names', () => {
    const row = toCompletedMatchRow({
      ...base,
      player_a: { display_name: 'Ada', username: 'ada' },
      player_b: { display_name: null, username: 'bola' },
    })
    expect([row.playerAName, row.playerBName]).toEqual(['Ada', 'bola'])
  })
  it('falls back to TBD when a side is empty', () => {
    expect(toCompletedMatchRow(base).playerAName).toBe('TBD')
  })
})
