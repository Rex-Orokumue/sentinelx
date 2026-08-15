import { Avatar } from '@/components/shared/Avatar'
import { TierBadge } from '@/components/player/TierBadge'
import { MembershipBadge } from './MembershipBadge'
import { AddFriendButton } from '@/components/player/AddFriendButton'
import { ChallengeButton } from '@/components/player/ChallengeButton'
import { formatMonthYear } from '@/lib/format'
import type { ProfileView } from '@/lib/players/profile'
import type { FriendshipStatus } from '@/lib/friends/list'

export function ProfileHeader({
  profile,
  viewerId,
  friendshipStatus,
  coinBalance,
}: {
  profile: ProfileView
  viewerId: string | null
  friendshipStatus: FriendshipStatus
  coinBalance?: number
}) {
  const name = profile.displayName ?? profile.username
  const since = formatMonthYear(profile.createdAt)
  return (
    <header className="relative overflow-hidden rounded-xl border border-sx-border bg-sx-surface p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sx-purple/20 blur-[90px]"
      />
      <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
        <Avatar
          avatarUrl={profile.avatarUrl}
          displayName={profile.displayName}
          username={profile.username}
          size={80}
          className="border-2 border-sx-purple/50 text-3xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-black text-white sm:text-3xl">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-sx-gray sm:justify-start">
            {profile.country && <span>📍 {profile.country}</span>}
            {since && <span>📅 Joined {since}</span>}
            <span title="SX Score reliability tier">
              <TierBadge tier={profile.sentinelTier} />
            </span>
            <span title="XP membership level">
              <MembershipBadge tier={profile.membershipTier} />
            </span>
            <span className="font-semibold text-sx-purple-text">
              {profile.rank != null ? `Ranked #${profile.rank}` : 'Unranked'}
            </span>
            {coinBalance != null && (
              <span className="rounded-full border border-sx-border bg-sx-bg px-2.5 py-0.5 text-[11px] font-bold text-white">
                🪙 {coinBalance.toLocaleString()}
              </span>
            )}
          </div>
          {profile.bio && (
            <p className="mt-3 whitespace-pre-line text-sm italic text-sx-gray">&ldquo;{profile.bio}&rdquo;</p>
          )}
          {viewerId && viewerId !== profile.id && (
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              <FriendStatusAction status={friendshipStatus} profileId={profile.id} />
              <ChallengeButton opponentId={profile.id} />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function FriendStatusAction({ status, profileId }: { status: FriendshipStatus; profileId: string }) {
  if (status === 'friends') {
    return <p className="text-sm font-semibold text-sx-green">✓ Friends</p>
  }
  if (status === 'pending_sent') {
    return <p className="text-sm text-sx-gray">Friend request sent</p>
  }
  if (status === 'pending_received') {
    return <p className="text-sm text-sx-gray">They sent you a friend request — check your dashboard</p>
  }
  return <AddFriendButton recipientId={profileId} />
}
