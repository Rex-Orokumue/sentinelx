import { gameGenreEmoji } from '@/lib/games/genre-emoji'

export type GameBadgeSize = 'sm' | 'md' | 'lg'

const SIZES: Record<GameBadgeSize, string> = {
  sm: 'h-5 w-5 text-[11px]',
  md: 'h-7 w-7 text-sm',
  lg: 'h-10 w-10 text-lg',
}

/**
 * Small square game marker for tournament/match surfaces. Pure and
 * client-safe — pass `iconUrl` already resolved via
 * `resolveGameIconUrl()` (Server Component only).
 */
export function GameBadge({
  name,
  iconUrl,
  category,
  size = 'sm',
  showName = false,
  className = '',
}: {
  name: string
  iconUrl?: string | null
  category?: string | null
  size?: GameBadgeSize
  showName?: boolean
  className?: string
}) {
  const box = SIZES[size]

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {iconUrl ? (
        // icon_url is an arbitrary host and next/image has no remotePatterns
        // configured — same reasoning as the banner_url <img> on the tournament
        // detail page.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt={showName ? '' : name}
          className={`${box} shrink-0 rounded-[5px] border border-white/10 object-cover`}
        />
      ) : (
        <span
          aria-hidden={showName || undefined}
          role={showName ? undefined : 'img'}
          aria-label={showName ? undefined : name}
          className={`${box} inline-flex shrink-0 items-center justify-center rounded-[5px] border border-white/10 bg-white/5`}
        >
          {gameGenreEmoji(category)}
        </span>
      )}
      {showName && <span className="truncate">{name}</span>}
    </span>
  )
}
