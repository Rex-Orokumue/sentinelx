import { describe, it, expect } from 'vitest'
import { validateLobbyResults } from './lobby-validation'

const three = ['a', 'b', 'c']

describe('validateLobbyResults', () => {
  it('passes a clean lobby', () => {
    // Three entrants, so at most two eliminations and therefore at most two
    // kills in total. 2 + 0 + 0 is the winner taking both.
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 2 },
        { entrantId: 'b', placement: 2, kills: 0 },
        { entrantId: 'c', placement: 3, kills: 0 },
      ],
    })

    expect(flags).toEqual([])
  })

  it('flags two entrants claiming the same placement', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 0 },
        { entrantId: 'b', placement: 1, kills: 0 },
        { entrantId: 'c', placement: 3, kills: 0 },
      ],
    })

    const dup = flags.find((f) => f.code === 'duplicate_placement')
    expect(dup).toBeDefined()
    expect(dup!.entrantIds.sort()).toEqual(['a', 'b'])
  })

  it('flags a placement beyond the number of entrants', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 9, kills: 0 },
        { entrantId: 'b', placement: 1, kills: 0 },
        { entrantId: 'c', placement: 2, kills: 0 },
      ],
    })

    expect(flags.find((f) => f.code === 'placement_out_of_range')?.entrantIds).toEqual(['a'])
  })

  it('flags total kills exceeding the maximum possible', () => {
    // Three entrants means at most two can be eliminated, so kills cannot
    // exceed two. More than that is a miscount or a false claim.
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 2 },
        { entrantId: 'b', placement: 2, kills: 2 },
        { entrantId: 'c', placement: 3, kills: 0 },
      ],
    })

    expect(flags.some((f) => f.code === 'impossible_kills')).toBe(true)
  })

  it('flags entrants who submitted nothing', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [{ entrantId: 'a', placement: 1, kills: 0 }],
    })

    const missing = flags.find((f) => f.code === 'missing_submission')
    expect(missing!.entrantIds.sort()).toEqual(['b', 'c'])
  })

  it('treats a blank placement as missing, not as zero', () => {
    // The admin grid renders empty cells for anyone who has not reported.
    const flags = validateLobbyResults({
      entrantIds: ['a', 'b'],
      rows: [
        { entrantId: 'a', placement: 1, kills: 0 },
        { entrantId: 'b', placement: null, kills: null },
      ],
    })

    expect(flags.find((f) => f.code === 'missing_submission')!.entrantIds).toEqual(['b'])
    expect(flags.some((f) => f.code === 'placement_out_of_range')).toBe(false)
  })

  it('reports every problem at once rather than stopping at the first', () => {
    // The admin fixes the grid in one pass; revealing one error at a time
    // turns a single correction into several round trips.
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 5 },
        { entrantId: 'b', placement: 1, kills: 5 },
      ],
    })

    expect(flags.map((f) => f.code).sort()).toEqual(
      ['duplicate_placement', 'impossible_kills', 'missing_submission'].sort(),
    )
  })

  it('gives every flag a message an admin can act on', () => {
    const flags = validateLobbyResults({
      entrantIds: three,
      rows: [
        { entrantId: 'a', placement: 1, kills: 0 },
        { entrantId: 'b', placement: 1, kills: 0 },
      ],
    })

    for (const f of flags) expect(f.message.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty lobby', () => {
    expect(validateLobbyResults({ entrantIds: [], rows: [] })).toEqual([])
  })
})
