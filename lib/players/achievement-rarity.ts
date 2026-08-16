export interface AchievementMeta {
  id: string
  slug: string
  name: string
  description: string
  category: string
}

export interface PlayerUnlockRow {
  achievement_id: string
  unlocked_at: string
}

export interface AchievementCell extends AchievementMeta {
  unlocked: boolean
  unlockedAt: string | null
  /** Total players who hold this achievement, across the whole platform — the rarity signal. */
  unlockCount: number
}

// Attaches per-player unlock state + a global rarity count to each achievement.
// `unlockCounts` is a Map<achievement_id, totalHolders> computed by the caller
// from a full player_achievements scan (see profile page wiring).
export function buildAchievementCells(
  achievements: AchievementMeta[],
  playerUnlocks: PlayerUnlockRow[],
  unlockCounts: Map<string, number>,
): AchievementCell[] {
  const unlockedAt = new Map(playerUnlocks.map((u) => [u.achievement_id, u.unlocked_at]))
  return achievements.map((a) => ({
    ...a,
    unlocked: unlockedAt.has(a.id),
    unlockedAt: unlockedAt.get(a.id) ?? null,
    unlockCount: unlockCounts.get(a.id) ?? 0,
  }))
}

// Top N *unlocked* achievements, rarest (fewest global holders) first, ties
// broken by most recently unlocked. Locked achievements never appear here —
// the showcase strip only celebrates what the player has actually earned.
export function topShowcase(cells: AchievementCell[], n = 3): AchievementCell[] {
  return cells
    .filter((c) => c.unlocked)
    .sort((a, b) => {
      if (a.unlockCount !== b.unlockCount) return a.unlockCount - b.unlockCount
      return new Date(b.unlockedAt!).getTime() - new Date(a.unlockedAt!).getTime()
    })
    .slice(0, n)
}
