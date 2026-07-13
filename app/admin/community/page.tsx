import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { AdminCommunityList } from '@/components/admin/AdminCommunityList'
import type { AdminCommunityPost } from '@/components/admin/AdminCommunityPostRow'

export const metadata: Metadata = { title: 'Community · Admin · SentinelX' }

type ProfileRef = { username: string | null } | { username: string | null }[] | null
function firstUsername(p: ProfileRef): string | null {
  return Array.isArray(p) ? p[0]?.username ?? null : p?.username ?? null
}
type GameRef = { name: string } | { name: string }[] | null
function firstGameName(g: GameRef): string {
  return (Array.isArray(g) ? g[0]?.name : g?.name) ?? 'Unknown game'
}

export default async function AdminCommunityPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('community_posts')
    .select(
      'id, body, image_url, created_at, ' +
        'author:profiles!community_posts_author_id_fkey(username), ' +
        'games(name), ' +
        'community_replies(count)',
    )
    .order('created_at', { ascending: false })
    .limit(50)

  const posts: AdminCommunityPost[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const p = raw as {
      id: string
      body: string
      image_url: string | null
      created_at: string
      author: ProfileRef
      games: GameRef
      community_replies: { count: number }[]
    }
    return {
      id: p.id,
      body: p.body,
      imageUrl: p.image_url,
      gameName: firstGameName(p.games),
      authorUsername: firstUsername(p.author),
      replyCount: p.community_replies?.[0]?.count ?? 0,
      createdAt: p.created_at,
    }
  })

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Community — recent posts</h2>
      {posts.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No posts yet.
        </p>
      ) : (
        <AdminCommunityList posts={posts} />
      )}
    </section>
  )
}
