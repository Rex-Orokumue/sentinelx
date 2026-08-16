'use client'
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
  const isBoosted = !!post.boostedUntil && new Date(post.boostedUntil) > new Date()
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
    <div className={`rounded-2xl border bg-sx-surface p-4 ${isAchievement ? 'border-amber-500/30' : isBoosted ? 'border-amber-400/50' : 'border-sx-border'}`}>
      {isAchievement && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🏅 Achievement Unlocked</p>}
      {isBoosted && <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-400">🚀 Boosted</p>}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <HexAvatar src={post.author.avatarUrl} username={name} tier={post.author.membershipTier as MembershipTier} size="xs" />
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
        <div className="flex shrink-0 items-center gap-3">
          {post.canBoost && (
            <button type="button" onClick={onBoost} disabled={pending} className="text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50">
              🚀 Boost (200 coins)
            </button>
          )}
          {post.canDelete && (
            <button type="button" onClick={onDelete} disabled={pending} className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50">
              Delete
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-sx-white/90">{post.content}</p>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {post.imageUrl && (
        <>
          <button type="button" onClick={() => setLightboxOpen(true)} className="mt-3 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageUrl} alt="" className="max-h-80 w-full rounded-lg object-cover" />
          </button>
          {lightboxOpen && (
            <ImageLightbox urls={[post.imageUrl]} index={0} onClose={() => setLightboxOpen(false)} onIndexChange={() => {}} />
          )}
        </>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <ReactionBar postId={post.id} counts={post.reactionCounts} myReaction={post.myReaction} loggedIn={loggedIn} />
        <div className="flex items-center gap-3">
          <Link href={`/community/${post.id}`} className="text-xs font-semibold text-sx-gray hover:text-sx-white">
            💬 {post.commentCount}
          </Link>
          <ShareButton post={post} />
        </div>
      </div>
    </div>
  )
}
