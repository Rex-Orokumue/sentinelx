import { describe, it, expect } from 'vitest'
import { buildAchievementCells, topShowcase, type AchievementMeta } from './achievement-rarity'

const ACHIEVEMENTS: AchievementMeta[] = [
  { id: 'a1', slug: 'first-win', name: 'First Win', description: 'Win your first match', category: 'matches' },
  { id: 'a2', slug: 'rare-one', name: 'Rare One', description: 'Do the rare thing', category: 'season' },
  { id: 'a3', slug: 'locked-one', name: 'Locked One', description: 'Not unlocked', category: 'profile' },
]

describe('buildAchievementCells', () => {
  it('marks unlocked achievements with their unlock time, locked with null', () => {
    const cells = buildAchievementCells(
      ACHIEVEMENTS,
      [
        { achievement_id: 'a1', unlocked_at: '2026-08-01T00:00:00Z' },
        { achievement_id: 'a2', unlocked_at: '2026-08-10T00:00:00Z' },
      ],
      new Map([['a1', 50], ['a2', 2], ['a3', 0]]),
    )
    expect(cells.find((c) => c.slug === 'first-win')).toMatchObject({ unlocked: true, unlockCount: 50 })
    expect(cells.find((c) => c.slug === 'rare-one')).toMatchObject({ unlocked: true, unlockCount: 2 })
    expect(cells.find((c) => c.slug === 'locked-one')).toMatchObject({ unlocked: false, unlockedAt: null, unlockCount: 0 })
  })
})

describe('topShowcase', () => {
  it('returns only unlocked cells, rarest (fewest holders) first', () => {
    const cells = buildAchievementCells(
      ACHIEVEMENTS,
      [
        { achievement_id: 'a1', unlocked_at: '2026-08-01T00:00:00Z' },
        { achievement_id: 'a2', unlocked_at: '2026-08-10T00:00:00Z' },
      ],
      new Map([['a1', 50], ['a2', 2], ['a3', 0]]),
    )
    const top = topShowcase(cells, 3)
    expect(top.map((c) => c.slug)).toEqual(['rare-one', 'first-win'])
  })

  it('breaks a rarity tie by most recently unlocked first', () => {
    const cells = buildAchievementCells(
      ACHIEVEMENTS,
      [
        { achievement_id: 'a1', unlocked_at: '2026-08-01T00:00:00Z' },
        { achievement_id: 'a2', unlocked_at: '2026-08-10T00:00:00Z' },
      ],
      new Map([['a1', 5], ['a2', 5], ['a3', 0]]),
    )
    const top = topShowcase(cells, 3)
    expect(top.map((c) => c.slug)).toEqual(['rare-one', 'first-win'])
  })

  it('caps at n', () => {
    const many: AchievementMeta[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id${i}`, slug: `slug${i}`, name: `N${i}`, description: 'd', category: 'matches',
    }))
    const unlocks = many.map((a) => ({ achievement_id: a.id, unlocked_at: '2026-08-01T00:00:00Z' }))
    const counts = new Map(many.map((a) => [a.id, 1]))
    const cells = buildAchievementCells(many, unlocks, counts)
    expect(topShowcase(cells, 3)).toHaveLength(3)
  })
})
