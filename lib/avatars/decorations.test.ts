import { describe, it, expect } from 'vitest'
import { resolveDecorations } from './decorations'

describe('resolveDecorations', () => {
  it('returns both null for an empty list', () => {
    expect(resolveDecorations([])).toEqual({ topRight: null, bottomRight: null })
  })

  it('picks the single matching decoration for each slot', () => {
    const r = resolveDecorations(['first_champion', 'win_streak_5'])
    expect(r.topRight?.slug).toBe('first_champion')
    expect(r.bottomRight?.slug).toBe('win_streak_5')
  })

  it('applies top-right priority: champions_cup_champion > masters_champion > champion_3x > first_champion', () => {
    expect(
      resolveDecorations(['first_champion', 'champion_3x', 'masters_champion', 'champions_cup_champion']).topRight
        ?.slug,
    ).toBe('champions_cup_champion')
    expect(resolveDecorations(['first_champion', 'champion_3x', 'masters_champion']).topRight?.slug).toBe(
      'masters_champion',
    )
    expect(resolveDecorations(['first_champion', 'champion_3x']).topRight?.slug).toBe('champion_3x')
  })

  it('applies bottom-right priority: win_streak_5 > matches_100', () => {
    expect(resolveDecorations(['matches_100', 'win_streak_5']).bottomRight?.slug).toBe('win_streak_5')
    expect(resolveDecorations(['matches_100']).bottomRight?.slug).toBe('matches_100')
  })

  it('ignores unknown slugs', () => {
    expect(resolveDecorations(['some_unrelated_slug'])).toEqual({ topRight: null, bottomRight: null })
  })
})
