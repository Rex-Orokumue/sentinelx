import { createClient } from '@/lib/supabase/server'
import { fetchFeedPage } from '@/lib/community/feed-query'
import { fetchChallengeWidget } from '@/lib/community/challenge-query'
import { fetchBestPlayBanner } from '@/lib/community/best-play-query'
import { NewPostLauncher } from '@/components/community/NewPostLauncher'
import type { ViewerProfile as ComposerViewer } from '@/components/community/PostComposer'
import { FeedList } from '@/components/community/FeedList'
import { ChallengeWidget } from '@/components/community/ChallengeWidget'
import { BestPlayBanner } from '@/components/community/BestPlayBanner'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

const PAGE_SIZE = 20

// Public feed, no auth required to read (spec §4). This route still calls
// createClient() (reads cookies) to resolve the viewer for reactions/delete
// state, which makes Next.js render it dynamically per-request regardless —
// see docs/superpowers/plans/2026-08-15-phase3-social-feed.md for why the
// `revalidate` directive below is kept anyway (matches the spec's intent,
// harmless given the rest of the codebase already renders every
// cookie-reading page dynamically).
export const revalidate = 60

export const metadata = buildMetadata({
  title: 'Community Feed — Sentinel X',
  description: "The heartbeat of SentinelX — match results, achievements, and banter from Nigeria's mobile esports community.",
  path: '/community',
  image: DEFAULT_OG_IMAGE,
})

export default async function CommunityPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const viewerId = user?.id ?? null

  const [{ pinned, posts, hasMore }, challengeWidget, bestPlay, viewerProfile] = await Promise.all([
    fetchFeedPage({ offset: 0, limit: PAGE_SIZE, viewerId }),
    fetchChallengeWidget(viewerId),
    fetchBestPlayBanner(viewerId),
    fetchComposerViewer(viewerId),
  ])

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="flex items-start justify-between gap-4 py-8">
        <div>
          <h1 className="font-display text-3xl font-black text-sx-white">Community Feed</h1>
          <p className="mt-1 text-sm text-sx-gray">Nigeria&apos;s Home of Mobile Esports</p>
        </div>
        <NewPostLauncher viewer={viewerProfile} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {bestPlay && <BestPlayBanner nominations={bestPlay.nominations} myVoteNominationId={bestPlay.myVoteNominationId} loggedIn={!!viewerId} />}
          <div className="mb-4 lg:hidden">{challengeWidget && <ChallengeWidget weekLabel={challengeWidget.weekLabel} challenges={challengeWidget.challenges} />}</div>
          <FeedList pinned={pinned} initialPosts={posts} initialHasMore={hasMore} loggedIn={!!viewerId} />
        </div>
        <div className="hidden lg:block">{challengeWidget && <ChallengeWidget weekLabel={challengeWidget.weekLabel} challenges={challengeWidget.challenges} />}</div>
      </div>
    </div>
  )
}

async function fetchComposerViewer(viewerId: string | null): Promise<ComposerViewer | null> {
  if (!viewerId) return null
  const supabase = createClient()
  const { data } = await supabase.from('profiles').select('avatar_url, username, display_name, membership_tier').eq('id', viewerId).maybeSingle()
  if (!data) return null
  return { avatarUrl: data.avatar_url, username: data.username, displayName: data.display_name, membershipTier: data.membership_tier }
}
