import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface PlayerCardData {
  username: string
  display_name: string | null
  avatar_url: string | null
  sx_score: number
  sentinel_tier: string | null
  membership_tier: string
}

export function PlayerCard({ player }: { player: PlayerCardData }) {
  return (
    <Link
      href={`/players/${player.username}`}
      className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
    >
      <HexAvatar
        src={player.avatar_url}
        username={player.display_name ?? player.username}
        tier={(player.membership_tier ?? 'recruit') as MembershipTier}
        size="xs"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-white">{player.display_name ?? player.username}</p>
        <p className="truncate text-xs text-slate-500">@{player.username}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-white">{player.sx_score}</p>
        <TierBadge tier={player.sentinel_tier} />
      </div>
    </Link>
  )
}
