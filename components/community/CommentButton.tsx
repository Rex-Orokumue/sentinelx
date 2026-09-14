import Link from 'next/link'
import { MessageCircle } from 'lucide-react'

// Always-visible comment action for the feed action row — the
// Facebook/Instagram restyle (8a512df) replaced this with a "View all N
// comments" link that only renders once commentCount > 0, leaving a
// zero-comment post with no way to open comments from the card at all.
// This restores a persistent entry point; the "View all N comments" preview
// link stays alongside it as the peek/count affordance, this is the action.
export function CommentButton({ postId }: { postId: string }) {
  return (
    <Link
      href={`/community/${postId}`}
      className="flex items-center gap-1.5 text-xs font-semibold text-sx-gray hover:text-white"
      aria-label="Comment"
    >
      <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Comment
    </Link>
  )
}
