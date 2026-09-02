import { findOptionalPublicImage } from '@/lib/media/optional-image'

export interface GameIconSource {
  /** Admin-set remote icon URL (games.icon_url). Wins when present. */
  iconUrl?: string | null
  icon_url?: string | null
  /** Used to fall back to the local key-art file at public/games/<slug>.<ext>. */
  slug?: string | null
}

/**
 * Best available image for a game, in order:
 *   1. games.icon_url (admin-set, any host)
 *   2. public/games/<slug>.{jpg,jpeg,png,webp} — the key art already shipped
 *      for every active game and rendered on /games
 *   3. null — caller shows the genre emoji fallback (see GameBadge)
 *
 * Server-only: step 2 reads the filesystem. Resolve here in a Server
 * Component and pass the string down to any Client Component that needs it.
 */
export function resolveGameIconUrl(game: GameIconSource | null | undefined): string | null {
  if (!game) return null
  const remote = game.iconUrl ?? game.icon_url ?? null
  if (remote) return remote
  if (game.slug) return findOptionalPublicImage('games', game.slug)
  return null
}
