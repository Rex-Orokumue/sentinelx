import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'
import { PostComposer } from '@/components/community/PostComposer'
import { PostCard, type PostView } from '@/components/community/PostCard'
import { EmptyState } from '@/components/shared/EmptyState'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'
const PAGE_SIZE = 30

export const metadata: Metadata = {
  title: 'Community — Sentinel X',
  description: "Discuss, share, and connect with Nigeria's mobile esports community on Sentinel X.",
  openGraph: {
    title: 'Community — Sentinel X',
    description: "Discuss, share, and connect with Nigeria's mobile esports community.",
    url: `${SITE_URL}/community`,
    siteName: 'Sentinel X',
    type: 'website',
  },
}

type ProfileRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null
function firstProfile(p: ProfileRef) {
  return Array.isArray(p) ? p[0] ?? null : p
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: { game?: string; before?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/community`)

  const [{ data: games }, staff] = await Promise.all([
    supabase.from('games').select('id, name, slug, icon_url').eq('active', true).order('name'),
    getStaffContext(),
  ])

  const gameList = games ?? []
  const activeSlug = searchParams.game ?? gameList[0]?.slug ?? null
  const activeGame = gameList.find((g) => g.slug === activeSlug) ?? null

  let posts: PostView[] = []
  let hasMore = false
  if (activeGame) {
    let query = supabase
      .from('community_posts')
      .select(
        'id, body, created_at, author_id, ' +
          'author:profiles!community_posts_author_id_fkey(username, display_name, avatar_url), ' +
          'community_post_images(image_url, display_order), ' +
          'community_replies(id, body, created_at, author_id, ' +
          'author:profiles!community_replies_author_id_fkey(username, display_name, avatar_url), ' +
          'community_reply_images(image_url, display_order))',
      )
      .eq('game_id', activeGame.id)
      .order('created_at', { ascending: false })
      .order('display_order', { ascending: true, foreignTable: 'community_post_images' })
      .order('created_at', { ascending: true, foreignTable: 'community_replies' })
      .order('display_order', { ascending: true, foreignTable: 'community_reply_images' })
      .limit(PAGE_SIZE)
    if (searchParams.before) query = query.lt('created_at', searchParams.before)
    const { data } = await query

    const rows = (data as unknown[] | null) ?? []
    hasMore = rows.length === PAGE_SIZE
    posts = rows.map((raw) => {
      const p = raw as {
        id: string
        body: string
        created_at: string
        author_id: string
        author: ProfileRef
        community_post_images: { image_url: string; display_order: number }[]
        community_replies: {
          id: string
          body: string
          created_at: string
          author_id: string
          author: ProfileRef
          community_reply_images: { image_url: string; display_order: number }[]
        }[]
      }
      const author = firstProfile(p.author)
      return {
        id: p.id,
        body: p.body,
        imageUrls: (p.community_post_images ?? []).map((i) => i.image_url),
        createdAt: p.created_at,
        authorUsername: author?.username ?? null,
        authorDisplayName: author?.display_name ?? null,
        authorAvatarUrl: author?.avatar_url ?? null,
        canDelete: user.id === p.author_id || !!staff?.isStaff,
        replies: p.community_replies.map((r) => {
          const rAuthor = firstProfile(r.author)
          return {
            id: r.id,
            body: r.body,
            imageUrls: (r.community_reply_images ?? []).map((i) => i.image_url),
            createdAt: r.created_at,
            authorUsername: rAuthor?.username ?? null,
            authorDisplayName: rAuthor?.display_name ?? null,
            authorAvatarUrl: rAuthor?.avatar_url ?? null,
            canDelete: user.id === r.author_id || !!staff?.isStaff,
          }
        }),
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Community</h1>
        <p className="mt-1 text-sm text-slate-400">
          Talk tactics, share highlights, and connect with other players.
        </p>
      </div>

      {gameList.length === 0 || !activeGame ? (
        <EmptyState icon="🤝" title="No games yet" body="Community boards will appear once a game is set up." />
      ) : (
        <>
          {gameList.length > 1 && <GameFilter games={gameList} active={activeGame.slug} />}

          <PostComposer gameId={activeGame.id} />

          {posts.length === 0 ? (
            <EmptyState icon="💬" title="No posts yet" body="Be the first to say something." />
          ) : (
            <div className="space-y-3">
              {posts.map((p) => (
                <PostCard key={p.id} post={p} canReply />
              ))}
            </div>
          )}

          {hasMore && posts.length > 0 && (
            <div className="mt-4 text-center">
              <Link
                href={`/community?game=${activeGame.slug}&before=${encodeURIComponent(posts[posts.length - 1].createdAt)}`}
                className="text-sm text-violet-400 hover:text-violet-300"
              >
                Load more →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GameFilter({ games, active }: { games: { name: string; slug: string }[]; active: string }) {
  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {games.map((g) => (
        <Link
          key={g.slug}
          href={`/community?game=${g.slug}`}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
            active === g.slug
              ? 'border-violet-500/40 bg-violet-500/20 text-violet-300'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600'
          }`}
        >
          {g.name}
        </Link>
      ))}
    </div>
  )
}
