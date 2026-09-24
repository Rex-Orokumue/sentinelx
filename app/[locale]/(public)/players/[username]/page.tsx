import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { friendshipStatus, type FriendshipStatus } from '@/lib/friends/list'
import { fetchProfileMessagingState } from '@/lib/messages/query'
import { fetchIsFollowing } from '@/lib/follows/query'
import { loadProfile, buildPlayerProfile } from '@/lib/players/service'
import { ProfileHeader } from '@/components/player/ProfileHeader'
import {
  AVATAR_BORDER_FRAMES,
  PROFILE_THEME_CLASSES,
  USERNAME_COLOUR_CLASSES,
} from '@/lib/store/cosmetics'
import { ProfileStats } from '@/components/player/ProfileStats'
import { ProfileAchievements } from '@/components/player/ProfileAchievements'
import { ProfileMatchHistory } from '@/components/player/ProfileMatchHistory'
import { ProfileGamesRow } from '@/components/player/ProfileGamesRow'
import { ProfileRecentActivity } from '@/components/player/ProfileRecentActivity'
import { CareerStatsRadar } from '@/components/player/CareerStatsRadar'
import { ProfileSidebarNav, ProfileTournamentsPromo } from '@/components/player/ProfileSidebarNav'
import { AchievementShowcase } from '@/components/player/AchievementShowcase'
import { XPProgressPanel } from '@/components/dashboard/XPProgressPanel'
import { SeasonStandingCard } from '@/components/dashboard/SeasonStandingCard'
import { ProfileCommunityPosts } from '@/components/player/ProfileCommunityPosts'
import { ProfileImageGrid } from '@/components/player/ProfileImageGrid'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildPlayerJsonLd } from '@/lib/seo/schema/player'
import { buildBreadcrumbJsonLd } from '@/lib/seo/schema/breadcrumb'

export async function generateMetadata({ params }: { params: { username: string; locale: Locale } }): Promise<Metadata> {
  const p = await loadProfile(createClient(), params.username)
  if (!p) return { title: 'Player not found — SentinelX Esports' }
  const name = p.display_name ?? p.username
  const title = `${name} (@${p.username}) — SentinelX Esports`
  const description = `SX Score ${p.sx_score} · ${p.wins}W–${p.losses}L · ${p.total_titles} titles on Sentinel X.`
  return buildMetadata({
    title,
    description,
    path: `/players/${p.username}`,
    locale: params.locale,
    type: 'profile',
    profileUsername: p.username,
  })
}

export default async function PlayerProfilePage({ params }: { params: { username: string } }) {
  const supabase = createClient()
  const p = await loadProfile(supabase, params.username)
  if (!p) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let friendship: FriendshipStatus = 'none'
  if (user && user.id !== p.id) {
    const { data: friendRow } = await supabase
      .from('friends')
      .select('requester_id, recipient_id, status')
      .or(`and(requester_id.eq.${user.id},recipient_id.eq.${p.id}),and(requester_id.eq.${p.id},recipient_id.eq.${user.id})`)
      .maybeSingle()
    if (friendRow) {
      friendship = friendshipStatus(
        [{ requesterId: friendRow.requester_id, recipientId: friendRow.recipient_id, status: friendRow.status }],
        user.id,
        p.id,
      )
    }
  }

  const messagingState =
    user && user.id !== p.id ? await fetchProfileMessagingState(user.id, p.id) : undefined

  const isFollowingProfile = user && user.id !== p.id ? await fetchIsFollowing(user.id, p.id) : false
  const theyFollowMe = user && user.id !== p.id ? await fetchIsFollowing(p.id, user.id) : false
  // Everything below this point is data the mobile API shares (lib/players/service.ts). The viewer-state lookups
  // above stay here and stay BEFORE it, so the query order is unchanged.
  const {
    profile,
    xp,
    matches,
    titles,
    gamesPlayed,
    achievementCells,
    unlockedSlugs,
    cosmetics,
    posts: profilePosts,
    gallery: galleryItems,
    isOwner,
    coinBalance,
    season: { rank: seasonRank, points: seasonPoints, pointsAtRankSixteen, monthlyRank, monthlyPoints },
  } = await buildPlayerProfile(supabase, () => createAdminClient(), p, user?.id ?? null)

  const displayName = p.display_name ?? p.username

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <JsonLd
        data={buildPlayerJsonLd({
          username: p.username,
          displayName: p.display_name,
          wins: p.wins,
          totalMatches: p.total_matches,
          sxScore: p.sx_score,
          sentinelTier: p.sentinel_tier,
        })}
      />
      <JsonLd
        data={buildBreadcrumbJsonLd([
          { name: 'Players', path: '/players' },
          { name: displayName, path: `/players/${p.username}` },
        ])}
      />

      <nav className="py-4 text-xs text-sx-gray">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-1.5">›</span>
        <Link href="/players" className="hover:text-white">Players</Link>
        <span className="mx-1.5">›</span>
        <span className="text-white">{displayName}</span>
      </nav>

      <div id="top" className="grid gap-6 pb-4 lg:grid-cols-[240px_1fr]">
        {/* ── Left sidebar ──────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <ProfileSidebarNav isOwner={isOwner} />
          <ProfileTournamentsPromo />
        </aside>

        {/* ── Main content ──────────────────────────────────── */}
        <div className="min-w-0 space-y-8">
          <ProfileHeader
            profile={profile}
            viewerId={user?.id ?? null}
            friendshipStatus={friendship}
            isFollowing={isFollowingProfile}
            followsViewer={theyFollowMe}
            coinBalance={coinBalance ?? undefined}
            achievements={unlockedSlugs}
            avatarFrameUrl={cosmetics.avatarBorder ? AVATAR_BORDER_FRAMES[cosmetics.avatarBorder] : undefined}
            profileThemeClass={cosmetics.profileTheme ? PROFILE_THEME_CLASSES[cosmetics.profileTheme] : undefined}
            usernameColourClass={cosmetics.usernameColour ? USERNAME_COLOUR_CLASSES[cosmetics.usernameColour] : undefined}
            messagingState={messagingState}
          />
          <ProfileStats profile={profile} />
          <XPProgressPanel xp={xp} coinBalance={isOwner ? (coinBalance ?? 0) : undefined} />
          <ProfileGamesRow games={gamesPlayed} />

          <div className="grid gap-8 lg:grid-cols-3">
            <ProfileAchievements titles={titles} />
            <CareerStatsRadar />
            <ProfileRecentActivity matches={matches} />
          </div>

          <AchievementShowcase achievements={achievementCells} />

          <ProfileMatchHistory matches={matches} username={params.username} />

          <ProfileCommunityPosts posts={profilePosts} username={params.username} />
          <ProfileImageGrid items={galleryItems} />

          {isOwner && (
            <SeasonStandingCard
              seasonRank={seasonRank}
              seasonPoints={seasonPoints}
              pointsAtRankSixteen={pointsAtRankSixteen}
              monthlyRank={monthlyRank}
              monthlyPoints={monthlyPoints}
            />
          )}
        </div>
      </div>
    </div>
  )
}