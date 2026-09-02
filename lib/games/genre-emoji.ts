import { CATEGORY_META } from '@/lib/games/categories'

/**
 * Genre emoji for a game category — the fallback marker shown when a game
 * has no icon_url and no local key art. Reuses the award emoji map so genre
 * iconography has a single source. Pure and client-safe (no filesystem).
 */
export function gameGenreEmoji(category: string | null | undefined): string {
  return (category && CATEGORY_META[category]?.awardEmoji) || '🎮'
}
