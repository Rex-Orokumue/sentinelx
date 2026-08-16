import { fetchPostDetail } from '@/lib/community/feed-query'
import { renderCommunityPostCard } from '@/lib/og/community-post-card'
import { OG_SIZE } from '@/lib/og/template'

export const runtime = 'edge'
export const size = OG_SIZE
export const contentType = 'image/png'

// Only reached for posts with no uploaded image — generateMetadata passes
// an explicit `image` (the real upload) for posts that have one, which
// overrides this file-convention route entirely (see buildMetadata's own
// comment). This route exists so a text-only post still shares as a
// branded card carrying the actual post content, not the generic
// site-wide default banner.
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
    })
  }
  const { post } = result
  const reactionCount = Object.values(post.reactionCounts).reduce((sum, n) => sum + n, 0)
  return renderCommunityPostCard({
    authorName: post.author.displayName ?? post.author.username ?? 'A player',
    authorUsername: post.author.username,
    authorAvatarUrl: post.author.avatarUrl,
    authorTier: post.author.sentinelTier,
    content: post.content,
    reactionCount,
    commentCount: post.commentCount,
  })
}
