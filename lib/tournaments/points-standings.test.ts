import { describe, it, expect } from 'vitest'
import { sortPointsStandings, type StageResultInput } from './points-standings'

const entrants = [
  { id: 'a', displayName: 'ShadowX' },
  { id: 'b', displayName: 'Kelvin_G' },
  { id: 'c', displayName: 'ZAYN' },
]

function r(
  entrantId: string,
  roundNo: number,
  placement: number,
  kills: number,
  placementPoints: number,
): StageResultInput {
  return { entrantId, roundNo, placement, kills, placementPoints, killPoints: kills }
}

describe('sortPointsStandings', () => {
  it('ranks by total points across the stage', () => {
    const rows = sortPointsStandings(
      entrants,
      [r('a', 1, 3, 2, 8), r('b', 1, 1, 4, 12), r('c', 1, 5, 1, 6)],
      2,
    )

    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a', 'c'])
    expect(rows[0].totalPoints).toBe(16) // 12 placement + 4 kills
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 3])
  })

  it('accumulates across every round of the stage', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [r('a', 1, 1, 0, 12), r('a', 2, 1, 0, 12), r('b', 1, 2, 5, 9), r('b', 2, 2, 5, 9)],
      1,
    )

    // 'a' takes 12 a round (a win, no kills) = 24.
    // 'b' takes 9 + 5 a round (2nd place, five kills) = 28.
    // Consistent finishing beats one big round, which is the whole point of
    // accumulating rather than scoring each round independently.
    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
    expect(rows[0].totalPoints).toBe(28)
    expect(rows[1].totalPoints).toBe(24)
    expect(rows.every((x) => x.played === 2)).toBe(true)
  })

  it('marks the top advance_count as advancing', () => {
    const rows = sortPointsStandings(
      entrants,
      [r('a', 1, 1, 0, 12), r('b', 1, 2, 0, 9), r('c', 1, 3, 0, 8)],
      2,
    )

    expect(rows.map((x) => x.advancing)).toEqual([true, true, false])
  })

  it('breaks a points tie on total kills', () => {
    // Both on 12. 'b' got there with more kills, which the official rules
    // reward — surviving passively should not beat fighting.
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [r('a', 1, 1, 0, 12), r('b', 1, 4, 5, 7)],
      1,
    )

    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
  })

  it('breaks a points-and-kills tie on best single placement', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [
        r('a', 1, 5, 2, 6), r('a', 2, 5, 0, 6),
        r('b', 1, 1, 2, 12), r('b', 2, 11, 0, 0),
      ],
      1,
    )

    // Both 14 points, both 2 kills; 'b' has a 1st place, 'a' has best 5th.
    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
  })

  it('breaks a deeper tie on the most recent round placement', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [
        r('a', 1, 1, 1, 12), r('a', 2, 8, 0, 3),
        r('b', 1, 8, 1, 3), r('b', 2, 1, 0, 12),
      ],
      1,
    )

    // Identical points, kills and best placement. 'b' won the latest round.
    expect(rows.map((x) => x.entrantId)).toEqual(['b', 'a'])
  })

  it('flags a tie that survives every tiebreak instead of inventing a winner', () => {
    const rows = sortPointsStandings(
      entrants.slice(0, 2),
      [r('a', 1, 3, 2, 8), r('b', 1, 3, 2, 8)],
      1,
    )

    // The system surfaces the tie; an admin resolves it. Advancement is
    // genuinely ambiguous here and guessing would silently eliminate someone.
    expect(rows[0].unresolvedTieWith).toContain(rows[1].entrantId)
    expect(rows[1].unresolvedTieWith).toContain(rows[0].entrantId)
  })

  it('includes an entrant who has played nothing yet, last and not advancing', () => {
    // Registered but their first lobby has not been confirmed. They must appear
    // on the table — an entrant missing from standings looks like a data loss
    // bug to the player refreshing the page.
    const rows = sortPointsStandings(entrants, [r('a', 1, 1, 0, 12)], 1)

    expect(rows).toHaveLength(3)
    const zero = rows.filter((x) => x.played === 0)
    expect(zero).toHaveLength(2)
    expect(zero.every((x) => !x.advancing)).toBe(true)
    expect(zero.every((x) => x.bestPlacement === null)).toBe(true)
  })

  it('ignores results for entrants not in this stage', () => {
    // Defensive: a stale row from a withdrawn entrant must not appear.
    const rows = sortPointsStandings(entrants.slice(0, 2), [r('a', 1, 1, 0, 12), r('zzz', 1, 1, 0, 12)], 1)

    expect(rows.map((x) => x.entrantId).sort()).toEqual(['a', 'b'])
  })

  it('returns an empty table for no entrants', () => {
    expect(sortPointsStandings([], [], 2)).toEqual([])
  })

  it('never marks more entrants advancing than exist', () => {
    const rows = sortPointsStandings(entrants.slice(0, 2), [r('a', 1, 1, 0, 12)], 10)
    expect(rows.filter((x) => x.advancing)).toHaveLength(2)
  })
})
