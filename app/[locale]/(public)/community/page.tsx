import { createClient } from '@/lib/supabase/server'
import { fetchFeedPage } from '@/lib/community/feed-query'
import { fetchChallengeWidget } from '@/lib/community/challenge-query'
import { fetchBestPlayBanner } from '@/lib/community/best-play-query'
import { fetchCommunityStats } from '@/lib/community/stats-query'
import { fetchTopCommunityMembers } from '@/lib/community/top-members-query'
import { fetchUpcomingCommunityEvents } from '@/lib/community/upcoming-events-query'
import { fetchCommunityGallery } from '@/lib/community/gallery-query'
import { NewPostLauncher } from '@/components/community/NewPostLauncher'
import type { ViewerProfile as ComposerViewer } from '@/components/community/PostComposer'
import { FeedList } from '@/components/community/FeedList'
import { ChallengeWidget } from '@/components/community/ChallengeWidget'
import { BestPlayBanner } from '@/components/community/BestPlayBanner'
import { CommunityHero } from '@/components/community/CommunityHero'
import { CommunityStatsBar } from '@/components/community/CommunityStatsBar'
import { QuickActionTiles } from '@/components/community/QuickActionTiles'
import { TopMembersWidget } from '@/components/community/TopMembersWidget'
import { UpcomingEventsWidget } from '@/components/community/UpcomingEventsWidget'
import { CommunityServersCard } from '@/components/community/CommunityServersCard'
import { CommunityGallery } from '@/components/community/CommunityGallery'
import { CommunityFooterCta } from '@/components/community/CommunityFooterCta'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

const PAGE_SIZE = 20
const WHATSAPP_COMMUNITY = process.env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL ?? '#'

// Public feed, no auth required to read (spec §4). This route still calls
// createClient() (reads cookies) to resolve the viewer for reactions/delete
// state, which makes Next.js render it dynamically per-request regardless —
// see docs/superpowers/plans/2026-08-15-phase3-social-feed.md for why the
// `revalidate` directive below is kept anyway (matches the spec's intent,
// harmless given the rest of the codebase already renders every
// cookie-reading page dynamically).
export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  return buildMetadata({
    title: 'Community Feed — Sentinel X',
    description:
      "The heartbeat of SentinelX — match results, achievements, and banter from Nigeria's mobile esports community.",
    path: '/community',
    image: DEFAULT_OG_IMAGE,
    locale,
  })
}

export default async function CommunityPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const viewerId = user?.id ?? null

  const [
    { pinned, posts, hasMore },
    challengeWidget,
    bestPlay,
    viewerProfile,
    stats,
    topMembers,
    upcomingEvents,
    gallery,
  ] = await Promise.all([
    fetchFeedPage({ offset: 0, limit: PAGE_SIZE, viewerId }),
    fetchChallengeWidget(viewerId),
    fetchBestPlayBanner(viewerId),
    fetchComposerViewer(viewerId),
    fetchCommunityStats(),
    fetchTopCommunityMembers(5),
    fetchUpcomingCommunityEvents(3),
    fetchCommunityGallery(0, 8),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <div className="py-6">
        <CommunityHero />
      </div>

      <div className="mb-6">
        <CommunityStatsBar stats={stats} />
      </div>

      <div className="mb-6">
        <QuickActionTiles />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div id="feed" className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-black text-white">Community Feed</h2>
            <div id="new-post-launcher">
              <NewPostLauncher viewer={viewerProfile} />
            </div>
          </div>
          {bestPlay && (
            <BestPlayBanner
              nominations={bestPlay.nominations}
              myVoteNominationId={bestPlay.myVoteNominationId}
              loggedIn={!!viewerId}
            />
          )}
          <div className="mb-4 lg:hidden">
            {challengeWidget && <ChallengeWidget weekLabel={challengeWidget.weekLabel} challenges={challengeWidget.challenges} />}
          </div>
          <FeedList pinned={pinned} initialPosts={posts} initialHasMore={hasMore} loggedIn={!!viewerId} />
        </div>
        <div className="hidden space-y-4 lg:block">
          <TopMembersWidget members={topMembers} />
          {challengeWidget && <ChallengeWidget weekLabel={challengeWidget.weekLabel} challenges={challengeWidget.challenges} />}
          <UpcomingEventsWidget events={upcomingEvents} />
        </div>
      </div>

      <div className="mt-6">
        <CommunityServersCard whatsappUrl={WHATSAPP_COMMUNITY} />
      </div>
      <div className="mt-6">
        <CommunityGallery initialItems={gallery.items} initialHasMore={gallery.hasMore} />
      </div>
      <div className="mt-6">
        <CommunityFooterCta />
      </div>
    </div>
  )
}

async function fetchComposerViewer(viewerId: string | null): Promise<ComposerViewer | null> {
  if (!viewerId) return null
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('avatar_url, username, display_name, membership_tier')
    .eq('id', viewerId)
    .maybeSingle()
  if (!data) return null
  return { avatarUrl: data.avatar_url, username: data.username, displayName: data.display_name, membershipTier: data.membership_tier }
}
