import { createClient } from '@/lib/supabase/server'
import { currentWeekStart } from './challenges'

export interface AdminPostRow {
  id: string
  content: string
  postType: string
  isPinned: boolean
  createdAt: string
  authorUsername: string | null
}

export async function fetchAdminPosts(limit = 50): Promise<AdminPostRow[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('community_posts')
    .select('id, content, post_type, is_pinned, created_at, author:profiles!community_posts_author_id_fkey(username)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  type AuthorRef = { username: string | null } | { username: string | null }[] | null
  return ((data ?? []) as unknown as { id: string; content: string; post_type: string; is_pinned: boolean; created_at: string; author: AuthorRef }[]).map((p) => ({
    id: p.id,
    content: p.content,
    postType: p.post_type,
    isPinned: p.is_pinned,
    createdAt: p.created_at,
    authorUsername: (Array.isArray(p.author) ? p.author[0]?.username : p.author?.username) ?? null,
  }))
}

export interface AdminStatusRow {
  id: string
  caption: string | null
  imageUrl: string | null
  createdAt: string
  expiresAt: string
  authorUsername: string | null
  viewCount: number
}

// Live statuses only (expires_at > now()), newest first. The view count needs
// the status_views_staff_read policy (20260909082245 migration).
export async function fetchAdminStatuses(limit = 60): Promise<AdminStatusRow[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_statuses')
    .select('id, caption, image_url, created_at, expires_at, author:profiles!player_statuses_player_id_fkey(username)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = ((data ?? []) as unknown as {
    id: string
    caption: string | null
    image_url: string | null
    created_at: string
    expires_at: string
    author: { username: string | null } | { username: string | null }[] | null
  }[])
  if (rows.length === 0) return []

  const { data: views } = await supabase
    .from('status_views')
    .select('status_id')
    .in('status_id', rows.map((r) => r.id))
  const countById = new Map<string, number>()
  for (const v of views ?? []) countById.set(v.status_id, (countById.get(v.status_id) ?? 0) + 1)

  return rows.map((r) => ({
    id: r.id,
    caption: r.caption,
    imageUrl: r.image_url,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    authorUsername: (Array.isArray(r.author) ? r.author[0]?.username : r.author?.username) ?? null,
    viewCount: countById.get(r.id) ?? 0,
  }))
}

export interface AdminNominationRow {
  nominationId: string
  postId: string
  content: string
  authorUsername: string | null
  voteCount: number
  isWinner: boolean
}

export async function fetchAdminNominations(): Promise<AdminNominationRow[]> {
  const supabase = createClient()
  const weekStart = currentWeekStart()
  const { data: nominations } = await supabase
    .from('best_play_nominations')
    .select('id, post_id, is_winner, post:community_posts(content, author:profiles!community_posts_author_id_fkey(username))')
    .eq('week_start', weekStart)
  if (!nominations || nominations.length === 0) return []

  const { data: votes } = await supabase
    .from('best_play_votes')
    .select('nomination_id')
    .in('nomination_id', nominations.map((n) => n.id))
  const countByNomination = new Map<string, number>()
  for (const v of votes ?? []) countByNomination.set(v.nomination_id, (countByNomination.get(v.nomination_id) ?? 0) + 1)

  type PostRow = { content: string; author: { username: string | null } | { username: string | null }[] | null }
  return nominations.map((n) => {
    const post = (Array.isArray(n.post) ? n.post[0] : n.post) as PostRow | null
    const author = post ? (Array.isArray(post.author) ? post.author[0] : post.author) : null
    return {
      nominationId: n.id,
      postId: n.post_id,
      content: post?.content ?? '',
      authorUsername: author?.username ?? null,
      voteCount: countByNomination.get(n.id) ?? 0,
      isWinner: n.is_winner,
    }
  })
}
