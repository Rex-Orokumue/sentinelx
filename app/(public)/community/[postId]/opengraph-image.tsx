import { fetchPostDetail } from '@/lib/community/feed-query'
import { renderCommunityPostCard } from '@/lib/og/community-post-card'
import { renderMatchCard } from '@/lib/og/match-card'
import { resultWinnerSide, type CardPlayer } from '@/lib/og/match-card-data'
import { OG_SIZE } from '@/lib/og/template'
import type { PlayerRef } from '@/lib/community/feed-query'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

function toCardPlayer(p: PlayerRef | null): CardPlayer {
  return { displayName: p?.displayName ?? null, username: p?.username ?? null, avatarUrl: p?.avatarUrl ?? null }
}

// Every post (with or without an uploaded image) renders through this
// route — generateMetadata no longer overrides it with the raw upload (see
// that file's comment for why). A post's own image, if any, renders as a
// thumbnail inside the branded card (lib/og/community-post-card.tsx)
// alongside the author's avatar, rather than instead of it.
//
// match_result posts are system-generated (author_id is null — see
// onMatchConfirmed in lib/community/feed-hooks.ts) and always lack an
// image, so they always land here. The generic author+content card would
// have shown a blank "A player" avatar and the raw templated text — using
// the same rich two-player score card as Match Centre's own OG image
// (lib/og/match-card.tsx) instead actually shows the match: both players,
// avatars, and the score.
export default async function Image({ params }: { params: { postId: string } }) {
  const result = await fetchPostDetail(params.postId, null)
  if (!result) {
    return renderCommunityPostCard({
      authorName: 'Sentinel X',
      authorUsername: null,
      authorAvatarUrl: null,
      authorTier: null,
      content: 'A post from the SentinelX community feed.',
      reactionCount: 0,
      commentCount: 0,
      postImageUrl: null,
    })
  }
  const { post } = result

  if (post.postType === 'match_result' && post.matchResult) {
    const m = post.matchResult
    return renderMatchCard({
      variant: 'result',
      tournamentTitle: m.tournamentTitle,
      playerA: toCardPlayer(m.playerA),
      playerB: toCardPlayer(m.playerB),
      scoreA: m.scoreA ?? 0,
      scoreB: m.scoreB ?? 0,
      winnerSide: resultWinnerSide(m.scoreA, m.scoreB),
    })
  }

  const reactionCount = Object.values(post.reactionCounts).reduce((sum, n) => sum + n, 0)
  return renderCommunityPostCard({
    authorName: post.author.displayName ?? post.author.username ?? 'A player',
    authorUsername: post.author.username,
    authorAvatarUrl: post.author.avatarUrl,
    authorTier: post.author.sentinelTier,
    content: post.content,
    reactionCount,
    commentCount: post.commentCount,
    postImageUrl: post.imageUrl,
  })
}
