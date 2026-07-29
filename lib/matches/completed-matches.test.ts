import { describe, it, expect } from 'vitest'
import { groupCompletedMatchesByDate, type CompletedMatchRow } from './completed-matches'

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
