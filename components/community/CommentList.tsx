import Link from 'next/link'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { formatRelativeTime } from '@/lib/format'
import type { MembershipTier } from '@/lib/membership/tiers'
import type { CommentView } from '@/lib/community/feed-query'
import { CommentDeleteButton } from './CommentDeleteButton'

// Server Component — all comments loaded on page load, no pagination in
// Phase 3 (spec §7, ≤50 comments assumed per post).
export function CommentList({ postId, comments }: { postId: string; comments: CommentView[] }) {
  if (comments.length === 0) {
    return <p className="mt-4 text-sm text-sx-gray">No comments yet — be the first to say something.</p>
  }
  return (
    <div className="mt-4 space-y-4">
      {comments.map((c) => {
        const name = c.author.displayName ?? c.author.username ?? 'Player'
        return (
          <div key={c.id} className="group flex items-start gap-2.5">
            <HexAvatar src={c.author.avatarUrl} username={name} tier={c.author.membershipTier as MembershipTier} size="xs" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-sx-white">
                {c.author.username ? (
                  <Link href={`/players/${c.author.username}`} className="hover:text-sx-purple-text">
                    {name}
                  </Link>
                ) : (
                  name
                )}{' '}
                <span className="font-normal text-sx-gray">· {formatRelativeTime(c.createdAt)}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-sx-white/90">{c.content}</p>
            </div>
            {c.canDelete && <CommentDeleteButton commentId={c.id} postId={postId} />}
          </div>
        )
      })}
    </div>
  )
}
