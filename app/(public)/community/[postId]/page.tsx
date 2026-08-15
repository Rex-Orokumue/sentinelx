import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { fetchPostDetail } from '@/lib/community/feed-query'
import { PostCard } from '@/components/community/PostCard'
import { CommentList } from '@/components/community/CommentList'
import { CommentInput } from '@/components/community/CommentInput'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

export async function generateMetadata({ params }: { params: { postId: string } }): Promise<Metadata> {
  const { post } = (await fetchPostDetail(params.postId, null)) ?? {}
  return buildMetadata({
    title: post ? `${post.content.slice(0, 80)} — Sentinel X Community` : 'Community Post — Sentinel X',
    description: post?.content.slice(0, 160) ?? 'A post from the SentinelX community feed.',
    path: `/community/${params.postId}`,
    image: post?.imageUrl ?? DEFAULT_OG_IMAGE,
  })
}

export default async function PostDetailPage({ params }: { params: { postId: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const viewerId = user?.id ?? null

  const result = await fetchPostDetail(params.postId, viewerId)
  if (!result) notFound()
  const { post, comments } = result

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="py-6">
        <Link href="/community" className="text-sm font-semibold text-sx-gray hover:text-sx-white">
          ← Back to Community
        </Link>
      </div>

      <PostCard post={post} loggedIn={!!viewerId} />

      {post.postType !== 'announcement' && (
        <div className="mt-6 rounded-2xl border border-sx-border bg-sx-surface p-4">
          <p className="text-xs font-black uppercase tracking-widest text-sx-white">Comments ({comments.length})</p>
          <CommentList postId={post.id} comments={comments} />
          <CommentInput postId={post.id} loggedIn={!!viewerId} />
        </div>
      )}
    </div>
  )
}
