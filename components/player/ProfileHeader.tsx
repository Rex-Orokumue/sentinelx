import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { MembershipBadge } from './MembershipBadge'
import { AddFriendButton } from '@/components/player/AddFriendButton'
import { ChallengeButton } from '@/components/player/ChallengeButton'
import { formatMonthYear } from '@/lib/format'
import type { ProfileView } from '@/lib/players/profile'
import type { FriendshipStatus } from '@/lib/friends/list'
import type { MembershipTier } from '@/lib/membership/tiers'

export function ProfileHeader({
  profile,
  viewerId,
  friendshipStatus,
  coinBalance,
  achievements,
  avatarBorderClass,
  profileThemeClass,
  usernameColourClass,
}: {
  profile: ProfileView
  viewerId: string | null
  friendshipStatus: FriendshipStatus
  coinBalance?: number
  /** Unlocked achievement slugs — drives the HexAvatar's decoration badges. */
  achievements?: string[]
  /** Equipped avatar_border cosmetic — a `ring-*` utility, additive with the avatar's own `border-*`. */
  avatarBorderClass?: string
  /** Equipped profile_theme cosmetic — REPLACES the default `bg-sx-surface`, never appended (Tailwind's
   *  generated CSS order isn't guaranteed to match class-string order, so the two `bg-*` utilities can't
   *  safely coexist — only one may apply). */
  profileThemeClass?: string
  /** Equipped username_colour cosmetic — REPLACES the default `text-white`, same reasoning as above. */
  usernameColourClass?: string
}) {
  const name = profile.displayName ?? profile.username
  const since = formatMonthYear(profile.createdAt)
  const isOwner = viewerId === profile.id

  return (
    <header
      className={`relative overflow-hidden rounded-xl border border-sx-border p-6 sm:p-8 ${profileThemeClass ?? 'bg-sx-surface'}`}
    >
      {/* Decorative glow. Kept well inside the header's own box (not just
          relying on overflow-hidden to clip it) — a blur radius wider than
          its offset can visually bleed past an ancestor's overflow-hidden
          on some WebKit/iOS renderers, which is the likely real cause of
          reported horizontal scroll on this page: this was previously the
          only element on the page whose geometry extended past its
          container at all. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-sx-purple/20 blur-[50px]"
      />
      <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-6 sm:text-left">
        <HexAvatar
          src={profile.avatarUrl}
          username={profile.displayName ?? profile.username}
          tier={(profile.membershipTier ?? 'recruit') as MembershipTier}
          achievements={achievements}
          size="xl"
          avatarBorderClass={avatarBorderClass}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <h1 className={`truncate font-display text-2xl font-black sm:text-3xl ${usernameColourClass ?? 'text-white'}`}>
              {name}
            </h1>
            {isOwner && (
              <Link
                href="/dashboard/settings"
                className="rounded-lg border border-sx-border px-2.5 py-1 text-xs font-semibold text-sx-gray hover:border-sx-purple/50 hover:text-white"
              >
                Edit Profile
              </Link>
            )}
          </div>
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
              {profile.seasonRank != null ? `Season Rank #${profile.seasonRank}` : 'Season: Unranked'}
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
          {viewerId && !isOwner && (
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
