import { Avatar } from '@/components/shared/Avatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatMonthYear } from '@/lib/format'
import type { ProfileView } from '@/lib/players/profile'

export function ProfileHeader({ profile }: { profile: ProfileView }) {
  const name = profile.displayName ?? profile.username
  const since = formatMonthYear(profile.createdAt)
  return (
    <header className="flex flex-col items-center gap-3 py-8 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
      <Avatar
        avatarUrl={profile.avatarUrl}
        displayName={profile.displayName}
        username={profile.username}
        size={72}
        className="text-2xl"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="text-sm text-slate-400">
          @{profile.username}
          {profile.country ? ` · ${profile.country}` : ''}
          {since ? ` · since ${since}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <span className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-bold text-white">
            {profile.sentinelScore}
            <span className="text-slate-500">/100</span>
          </span>
          <TierBadge tier={profile.sentinelTier} />
          <span className="text-sm font-semibold text-violet-400">
            {profile.rank != null ? `Ranked #${profile.rank}` : 'Unranked'}
          </span>
        </div>
        {profile.bio && <p className="mt-3 whitespace-pre-line text-sm text-slate-300">{profile.bio}</p>}
      </div>
    </header>
  )
}
