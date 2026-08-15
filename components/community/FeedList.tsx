'use client'
import { useEffect, useState, useTransition } from 'react'
import type { PostView } from '@/lib/community/feed-query'
import { loadMorePosts } from '@/lib/community/load-more-action'
import { PostCard } from './PostCard'
import { FeedFilters, type FeedFilter } from './FeedFilters'
import { EmptyState } from '@/components/shared/EmptyState'

function matchesFilter(post: PostView, filter: FeedFilter): boolean {
  if (filter === 'all') return true
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
}: {
  pinned: PostView[]
  initialPosts: PostView[]
  initialHasMore: boolean
  loggedIn: boolean
}) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [posts, setPosts] = useState(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, startTransition] = useTransition()

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

  const visiblePinned = pinned.filter((p) => matchesFilter(p, filter))
  const visiblePosts = posts.filter((p) => matchesFilter(p, filter))

  return (
    <div>
      <FeedFilters active={filter} onChange={setFilter} />

      {visiblePinned.length === 0 && visiblePosts.length === 0 ? (
        <EmptyState icon="💬" title="No posts yet" body="Be the first to say something." />
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
