import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatMonthYear, formatNaira } from '@/lib/format'

export function ChampionsCupCard({
  avatarUrl,
  name,
  achievements,
  sentinelTier,
  slug,
  date,
  prizePool,
  seasonName,
}: {
  avatarUrl: string | null
  name: string
  /** Champion's unlocked achievement slugs — drives the HexAvatar's decoration badges. */
  achievements?: string[]
  sentinelTier: string | null
  slug: string
  date: string | null
  prizePool: number
  seasonName: string | null
}) {
  return (
    <div
      className="rounded-2xl border border-sx-purple/60 bg-gradient-to-r from-sx-purple/20 via-sx-surface to-amber-900/20 p-8 text-center sm:text-left"
      style={{ boxShadow: '0 0 40px rgba(124,58,237,0.25)' }}
    >
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        {/* Champions Cup winner always gets Legend-tier glow — spec §5 */}
        <HexAvatar src={avatarUrl} username={name} tier="legend" achievements={achievements} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
              {seasonName ?? 'Season'} Champion
            </p>
          </div>
          <p className="mt-1 font-display text-3xl font-black text-white">{name}</p>
          <TierBadge tier={sentinelTier} />
          <p className="mt-3 text-sm text-sx-gray">
            🏆 SentinelX Champions Cup
            <br />
            {formatMonthYear(date) ?? 'Date TBD'} · {formatNaira(prizePool)} Prize
          </p>
          <Link href={`/tournaments/${slug}`} className="mt-3 inline-block text-sm font-bold text-sx-purple-text hover:text-sx-purple-light">
            View Tournament →
          </Link>
        </div>
      </div>
    </div>
  )
}

export function ChampionsCupEmptyCard() {
  return (
    <div className="rounded-2xl border border-sx-purple/30 bg-sx-bg/40 p-10 text-center opacity-70">
      <p className="text-4xl grayscale">🏆</p>
      <p className="mt-3 font-display text-lg font-black text-white">The Champions Cup throne awaits its first legend</p>
      <p className="mt-1 text-sm text-sx-gray">Season 1 Champion crowned in July 2027</p>
    </div>
  )
}
