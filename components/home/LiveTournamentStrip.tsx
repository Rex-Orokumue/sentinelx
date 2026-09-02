import Link from 'next/link'
import { formatNaira } from '@/lib/format'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { GameBadge } from '@/components/game/GameBadge'
import { resolveGameIconUrl } from '@/lib/games/icon'

// Full-width banner directly under the Hero. Replaces the old
// StatsBar+LiveTournamentCard slot. Renders nothing when there's no
// active/registration_open tournament — Four Pillars becomes the first
// section after the Hero instead (spec: empty-state is omission, not a
// placeholder card).
export function LiveTournamentStrip({ tournament: t }: { tournament: TournamentCardData | null }) {
  if (!t) return null

  const isLive = t.status === 'active'

  return (
    <div className="mx-4 mb-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sx-purple/25 bg-gradient-to-r from-sx-purple/10 to-transparent px-5 py-4 sm:mx-6 lg:mx-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-sx-green/30 bg-sx-green/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sx-green">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sx-green" />
          {isLive ? 'Live Now' : 'Registration Open'}
        </span>
        <span className="inline-flex items-center gap-2 font-display text-base font-bold uppercase tracking-wide text-white">
          {t.games && (
            <GameBadge
              name={t.games.name}
              iconUrl={resolveGameIconUrl(t.games)}
              category={t.games.category}
              size="md"
            />
          )}
          {t.title}
        </span>
        <span className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-sx-amber">{formatNaira(t.prize_pool)} Prize Pool</span>
          {t.max_players != null && <span className="text-sx-gray">· {t.max_players} max players</span>}
        </span>
      </div>
      <Link
        href={`/tournaments/${t.slug}`}
        className="whitespace-nowrap rounded-lg bg-sx-purple px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-sx-purple-light"
      >
        {isLive ? 'Watch Now' : `Register — ${formatNaira(t.registration_fee)}`}
      </Link>
    </div>
  )
}
