export interface CategoryMeta {
  statLabel: string
  awardName: string
  awardEmoji: string
}

// 'other' and any future uncategorized game deliberately have NO entry here —
// callers must always use CATEGORY_META[category]?.field, never assume a
// lookup is defined, except when indexing by a literal key written directly
// in source (e.g. CATEGORY_META.football).
export const CATEGORY_META: Record<string, CategoryMeta> = {
  football: { statLabel: 'Goals', awardName: 'Golden Boot', awardEmoji: '⚽' },
  fighting: { statLabel: 'Rounds Won', awardName: 'Iron Fist', awardEmoji: '🥊' },
  shooter: { statLabel: 'Kills', awardName: 'Sharpshooter', awardEmoji: '🎯' },
}
