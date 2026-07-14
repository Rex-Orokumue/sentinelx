import Link from 'next/link'
import { Avatar } from '@/components/shared/Avatar'
import { TierBadge } from '@/components/player/TierBadge'

export interface PlayerCardData {
  username: string
  display_name: string | null
  avatar_url: string | null
  sentinel_score: number
  sentinel_tier: string | null
}

export function PlayerCard({ player }: { player: PlayerCardData }) {
  return (
    <Link
      href={`/players/${player.username}`}
      className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
    >
      <Avatar
        avatarUrl={player.avatar_url}
        displayName={player.display_name}
        username={player.username}
        size={44}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-white">{player.display_name ?? player.username}</p>
        <p className="truncate text-xs text-slate-500">@{player.username}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-white">
          {player.sentinel_score}
          <span className="text-slate-500">/100</span>
        </p>
        <TierBadge tier={player.sentinel_tier} />
      </div>
    </Link>
  )
}
