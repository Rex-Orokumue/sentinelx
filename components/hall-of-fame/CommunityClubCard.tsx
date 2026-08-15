import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatDate } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'

export function CommunityClubCard({
  avatarUrl,
  name,
  membershipTier,
  sentinelTier,
  slug,
  title,
  date,
  runnerUpName,
}: {
  avatarUrl: string | null
  name: string
  membershipTier: string | null
  sentinelTier: string | null
  slug: string
  title: string
  date: string | null
  runnerUpName: string | null
}) {
  return (
    <div className="rounded-xl border border-sx-border bg-sx-surface p-4 text-center">
      <div className="flex justify-center">
        <HexAvatar src={avatarUrl} username={name} tier={(membershipTier ?? 'recruit') as MembershipTier} size="md" />
      </div>
      <p className="mt-2 font-bold text-white">{name}</p>
      <TierBadge tier={sentinelTier} />
      <div className="mt-2 border-t border-sx-border pt-2 text-xs text-sx-gray">
        ⚡ {title}
        <br />
        {formatDate(date) ?? 'Date TBD'}
        <br />
        <Link href={`/tournaments/${slug}`} className="mt-1 inline-block font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View →
        </Link>
      </div>
      {runnerUpName && <p className="mt-1.5 text-[11px] text-sx-gray">🥈 {runnerUpName}</p>}
    </div>
  )
}
