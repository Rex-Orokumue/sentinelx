'use client'
import { isBoostLive } from '@/lib/community/boost'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { TierBadge } from '@/components/player/TierBadge'
import { formatRelativeTime } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'
import type { PostView } from '@/lib/community/feed-query'
import { deletePost, boostPost } from '@/lib/community/post-actions'
import { MatchResultCard } from './MatchResultCard'
import { AnnouncementCard } from './AnnouncementCard'
import { ReactionBar } from './ReactionBar'
import { ShareButton } from './ShareButton'
import { PostOverflowMenu } from './PostOverflowMenu'
import { ImageLightbox } from './ImageLightbox'

// Handles all 4 post types (spec §13). match_result and announcement get a
// distinct visual treatment and delegate out; manual and achievement share
// this layout, differing only in border/header accent.
export function PostCard({ post, loggedIn }: { post: PostView; loggedIn: boolean }) {
  if (post.postType === 'match_result') return <MatchResultCard post={post} loggedIn={loggedIn} />
  if (post.postType === 'announcement') return <AnnouncementCard post={post} />
  return <ManualOrAchievementCard post={post} loggedIn={loggedIn} />
}

function ManualOrAchievementCard({ post, loggedIn }: { post: PostView; loggedIn: boolean }) {
  const router = useRouter()
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isAchievement = post.postType === 'achievement'
  // Shared with the feed's ranking and canBoost, so the badge and the position
  // can never disagree again — they did for three weeks.
  const isBoosted = isBoostLive(post.boostedUntil, new Date())
  const name = post.author.displayName ?? post.author.username ?? 'Player'

  function onDelete() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', post.id)
      const res = await deletePost(undefined, fd)
      if (res?.error) setError(res.error)
      else router.refresh()
    })
  }

  function onBoost() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', post.id)
      const res = await boostPost(undefined, fd)
      if (res?.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className={`overflow-hidden rounded-2xl border bg-sx-surface ${isAchievement ? 'border-amber-500/30' : isBoosted ? 'border-amber-400/50' : 'border-sx-border'}`}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        {isAchievement && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🏅 Achievement Unlocked</p>}
        {isBoosted && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🚀 Boosted</p>}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <HexAvatar src={post.author.avatarUrl} username={name} tier={post.author.membershipTier as MembershipTier} size="xs" frameUrl={post.author.frameUrl} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-sx-white">
                {post.author.username ? (
                  <Link href={`/players/${post.author.username}`} className="hover:text-sx-purple-text">
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <TierBadge tier={post.author.sentinelTier} />
                <span className="text-[11px] text-sx-gray">· {formatRelativeTime(post.createdAt)}</span>
              </div>
            </div>
          </div>
          <PostOverflowMenu
            postId={post.id}
            canBoost={post.canBoost}
            canDelete={post.canDelete}
            loggedIn={loggedIn}
            muted={post.mutedByViewer}
            pending={pending}
            onBoost={onBoost}
            onDelete={onDelete}
          />
        </div>

        <p className="mt-3 whitespace-pre-line text-sm text-sx-white/90">{post.content}</p>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {post.imageUrl && (
        <>
          <button type="button" onClick={() => setLightboxOpen(true)} className="mt-3 block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt="" className="max-h-[32rem] w-full object-cover" />
          </button>
          {lightboxOpen && (
            <ImageLightbox urls={[post.imageUrl]} index={0} onClose={() => setLightboxOpen(false)} onIndexChange={() => {}} />
          )}
        </>
      )}

      <div className="p-4 pt-3 sm:p-5 sm:pt-3">
        <div className="flex items-center gap-4">
          <ReactionBar postId={post.id} counts={post.reactionCounts} myReaction={post.myReaction} loggedIn={loggedIn} />
          <ShareButton post={post} />
        </div>
        {post.commentCount > 0 && (
          <Link href={`/community/${post.id}`} className="mt-2 block text-xs font-semibold text-sx-gray hover:text-white">
            View all {post.commentCount} comment{post.commentCount === 1 ? '' : 's'}
          </Link>
        )}
      </div>
    </div>
  )
}
