'use client'

import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { useCountUp } from '@/lib/home/useCountUp'
import type { MembershipTier } from '@/lib/membership/tiers'

export interface LeaderboardPlayer {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  wins: number
  sx_score: number
  sentinel_tier: string | null
  // Supabase's generated type for this column is plain `string` (see
  // lib/supabase/types.ts) — same convention already used by
  // PlayerStatsInput.membershipTier and AllTimeAwardCard's prop; cast to
  // MembershipTier at the HexAvatar call site below, not in this interface.
  membership_tier: string | null
}

// Rank 1/2/3/rest colors, matching the mockup's r-gold/r-silver/r-bronze/r-dim.
const RANK_CLASS = ['text-sx-amber', 'text-white/70', 'text-amber-700', 'text-sx-gray']

export function LeaderboardRow({ player, rank }: { player: LeaderboardPlayer; rank: number }) {
  const score = useCountUp<HTMLSpanElement>(player.sx_score)
  const name = player.display_name ?? player.username ?? 'Anonymous'
  const rankClass = RANK_CLASS[Math.min(rank - 1, 3)]

  return (
    <div
      className={`flex items-center gap-3.5 rounded-xl border border-sx-border bg-sx-bg p-3 transition-colors hover:border-sx-purple/40 ${
        rank <= 3 ? 'bg-sx-purple/[0.04]' : ''
      }`}
    >
      <span className={`w-6 shrink-0 text-center font-display text-xl font-black ${rankClass}`}>{rank}</span>
      <HexAvatar
        src={player.avatar_url}
        username={name}
        tier={(player.membership_tier ?? 'recruit') as MembershipTier}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-sx-gray">
          <TierBadge tier={player.sentinel_tier} />
          <span>· {player.wins} Wins</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span ref={score.ref} className="block font-display text-xl font-black leading-none text-white">
          {score.value}
        </span>
        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-widest text-sx-gray/70">
          SX Score
        </span>
      </div>
    </div>
  )
}
