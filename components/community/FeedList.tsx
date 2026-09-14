'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import type { PostView } from '@/lib/community/feed-query'
import { loadMorePosts } from '@/lib/community/load-more-action'
import { PostCard } from './PostCard'
import { FeedFilters, type FeedFilter } from './FeedFilters'
import { EmptyState } from '@/components/shared/EmptyState'

function matchesFilter(post: PostView, filter: FeedFilter, followingIds: Set<string>): boolean {
  if (filter === 'all') return true
  if (filter === 'following') return post.author.id != null && followingIds.has(post.author.id)
  if (filter === 'results') return post.postType === 'match_result'
  if (filter === 'announcements') return post.postType === 'announcement'
  if (filter === 'achievements') return post.postType === 'achievement'
  return true
}

export function FeedList({
  pinned,
  initialPosts,
  initialHasMore,
  loggedIn,
  followingIds = [],
}: {
  pinned: PostView[]
  initialPosts: PostView[]
  initialHasMore: boolean
  loggedIn: boolean
  /** Ids the viewer follows — drives the Following tab. Empty/omitted when logged out. */
  followingIds?: string[]
}) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [posts, setPosts] = useState(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, startTransition] = useTransition()
  const followingIdSet = useMemo(() => new Set(followingIds), [followingIds])

  // A fresh initialPosts identity means the server re-fetched page 1 (e.g.
  // after creating a post triggers router.refresh()) — resync, collapsing
  // any "loaded more" pages back to page 1. Acceptable tradeoff for Phase 3.
  useEffect(() => {
    setPosts(initialPosts)
    setHasMore(initialHasMore)
  }, [initialPosts, initialHasMore])

  function onLoadMore() {
    startTransition(async () => {
      const page = await loadMorePosts(posts.length)
      setPosts((prev) => [...prev, ...page.posts])
      setHasMore(page.hasMore)
    })
  }

  const visiblePinned = pinned.filter((p) => matchesFilter(p, filter, followingIdSet))
  const visiblePosts = posts.filter((p) => matchesFilter(p, filter, followingIdSet))
  const noPosts = visiblePinned.length === 0 && visiblePosts.length === 0

  return (
    <div>
      <FeedFilters active={filter} onChange={setFilter} showFollowing={loggedIn} />

      {noPosts ? (
        filter === 'following' ? (
          <EmptyState
            icon="👋"
            title="Follow players to see their posts here"
            body="Visit a player's profile and tap Follow — their posts will show up in this tab."
          />
        ) : (
          <EmptyState icon="💬" title="No posts yet" body="Be the first to say something." />
        )
      ) : (
        <div className="space-y-3">
          {visiblePinned.map((p) => (
            <PostCard key={p.id} post={p} loggedIn={loggedIn} />
          ))}
          {visiblePosts.map((p) => (
            <PostCard key={p.id} post={p} loggedIn={loggedIn} />
          ))}
        </div>
      )}

      {hasMore && filter === 'all' && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={pending}
            className="rounded-lg border border-sx-border px-5 py-2 text-xs font-bold text-sx-gray hover:border-sx-purple/40 hover:text-sx-white disabled:opacity-50"
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
