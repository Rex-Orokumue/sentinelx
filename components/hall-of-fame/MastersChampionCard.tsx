import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatNaira } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'

export function MastersChampionCard({
  title,
  avatarUrl,
  name,
  membershipTier,
  sentinelTier,
  slug,
  prizePool,
  runnerUpName,
}: {
  title: string
  avatarUrl: string | null
  name: string
  membershipTier: string | null
  sentinelTier: string | null
  slug: string
  prizePool: number
  runnerUpName: string | null
}) {
  return (
    <div
      className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-[#1A1200] to-sx-surface p-5 text-center"
      style={{ boxShadow: '0 0 20px rgba(245,158,11,0.12)' }}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-amber-400">👑 Masters Champion</p>
      <p className="text-xs text-sx-gray">{title}</p>
      <div className="my-3 flex justify-center border-t border-amber-500/20 pt-3">
        <HexAvatar src={avatarUrl} username={name} tier={(membershipTier ?? 'recruit') as MembershipTier} size="lg" />
      </div>
      <p className="font-display text-lg font-black text-white">{name}</p>
      <TierBadge tier={sentinelTier} />
      <div className="mt-3 border-t border-amber-500/20 pt-3 text-sm text-sx-gray">
        🏆 1st Place · {formatNaira(prizePool)}
        <br />
        <Link href={`/tournaments/${slug}`} className="mt-1 inline-block font-bold text-sx-purple-text hover:text-sx-purple-light">
          View Tournament →
        </Link>
      </div>
      {runnerUpName && <p className="mt-2 text-xs text-sx-gray">🥈 Runner-up: {runnerUpName}</p>}
    </div>
  )
}

export function MastersChampionEmptyCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-sx-surface p-5 text-center opacity-60">
      <p className="text-2xl grayscale">👑</p>
      <p className="mt-2 text-sm font-bold text-amber-200/70">{title} · Champion to be crowned</p>
    </div>
  )
}
