// Mirrors the achievements.category CHECK constraint in
// supabase/migrations/053_achievements.sql — keep these two in sync.
export const ACHIEVEMENT_CATEGORIES = ['matches', 'tournaments', 'score', 'season', 'profile', 'community'] as const
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number]

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  matches: 'Matches',
  tournaments: 'Tournaments',
  score: 'SX Score',
  season: 'Season',
  profile: 'Profile',
  community: 'Community',
}
