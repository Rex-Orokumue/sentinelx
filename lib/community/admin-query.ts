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
