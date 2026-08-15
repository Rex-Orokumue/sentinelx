import { createClient } from '@/lib/supabase/server'
import { ROUND_LABELS } from '@/lib/tournaments/bracket'
import type { ReactionType } from './schema'
import { REACTIONS } from './schema'

export type PostType = 'manual' | 'match_result' | 'achievement' | 'announcement'

export interface PlayerRef {
  id: string | null
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  membershipTier: string
  sentinelTier: string | null
}

export interface MatchResultDetail {
  matchId: string
  tournamentTitle: string
  roundLabel: string
  scoreA: number | null
  scoreB: number | null
  playerA: PlayerRef | null
  playerB: PlayerRef | null
  scheduledAt: string | null
}

export interface PostView {
  id: string
  postType: PostType
  content: string
  imageUrl: string | null
  referenceId: string | null
  isPinned: boolean
  createdAt: string
  author: PlayerRef
  canDelete: boolean
  reactionCounts: Record<ReactionType, number>
  myReaction: ReactionType | null
  commentCount: number
  matchResult: MatchResultDetail | null
}

type ProfileRow = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  membership_tier: string
  sentinel_tier: string | null
}
type ProfileRef = ProfileRow | ProfileRow[] | null
function firstProfile(p: ProfileRef): ProfileRow | null {
  return Array.isArray(p) ? (p[0] ?? null) : p
}
function toPlayerRef(p: ProfileRow | null): PlayerRef {
  return {
    id: p?.id ?? null,
    username: p?.username ?? null,
    displayName: p?.display_name ?? null,
    avatarUrl: p?.avatar_url ?? null,
    membershipTier: p?.membership_tier ?? 'recruit',
    sentinelTier: p?.sentinel_tier ?? null,
  }
}

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, membership_tier, sentinel_tier'

type RawPost = {
  id: string
  author_id: string | null
  content: string
  image_url: string | null
  post_type: PostType
  reference_id: string | null
  is_pinned: boolean
  created_at: string
  author: ProfileRef
}

// Shared by the feed page and the post detail page. Fetches posts + author
// profiles + reaction counts + comment counts + (for match_result posts)
// the underlying match in a fixed small number of round trips — never one
// query per post (spec §14).
async function hydratePosts(rows: RawPost[], viewerId: string | null): Promise<PostView[]> {
  const supabase = createClient()
  const postIds = rows.map((r) => r.id)
  if (postIds.length === 0) return []

  const [{ data: reactions }, { data: comments }] = await Promise.all([
    supabase.from('post_reactions').select('post_id, player_id, reaction').in('post_id', postIds),
    supabase.from('post_comments').select('post_id').in('post_id', postIds).eq('is_deleted', false),
  ])

  const reactionCountsByPost = new Map<string, Record<ReactionType, number>>()
  const myReactionByPost = new Map<string, ReactionType>()
  for (const r of reactions ?? []) {
    const counts = reactionCountsByPost.get(r.post_id) ?? { fire: 0, crown: 0, strong: 0, wow: 0 }
    counts[r.reaction as ReactionType]++
    reactionCountsByPost.set(r.post_id, counts)
    if (viewerId && r.player_id === viewerId) myReactionByPost.set(r.post_id, r.reaction as ReactionType)
  }
  const commentCountByPost = new Map<string, number>()
  for (const c of comments ?? []) {
    commentCountByPost.set(c.post_id, (commentCountByPost.get(c.post_id) ?? 0) + 1)
  }

  const matchIds = rows.filter((r) => r.post_type === 'match_result' && r.reference_id).map((r) => r.reference_id as string)
  const matchDetailById = new Map<string, MatchResultDetail>()
  if (matchIds.length > 0) {
    const { data: matches } = await supabase
      .from('matches')
      .select(
        'id, round, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(' + PROFILE_FIELDS + '), ' +
          'player_b:profiles!matches_player_b_id_fkey(' + PROFILE_FIELDS + '), ' +
          'tournament:tournaments(title)',
      )
      .in('id', matchIds)
    type TournamentRef = { title: string } | { title: string }[] | null
    for (const m of (matches ?? []) as unknown as {
      id: string
      round: string
      score_a: number | null
      score_b: number | null
      scheduled_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
      tournament: TournamentRef
    }[]) {
      const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament
      matchDetailById.set(m.id, {
        matchId: m.id,
        tournamentTitle: t?.title ?? 'SentinelX',
        roundLabel: ROUND_LABELS[m.round] ?? m.round,
        scoreA: m.score_a,
        scoreB: m.score_b,
        playerA: firstProfile(m.player_a) ? toPlayerRef(firstProfile(m.player_a)) : null,
        playerB: firstProfile(m.player_b) ? toPlayerRef(firstProfile(m.player_b)) : null,
        scheduledAt: m.scheduled_at,
      })
    }
  }

  return rows.map((r) => ({
    id: r.id,
    postType: r.post_type,
    content: r.content,
    imageUrl: r.image_url,
    referenceId: r.reference_id,
    isPinned: r.is_pinned,
    createdAt: r.created_at,
    author: toPlayerRef(firstProfile(r.author)),
    canDelete: r.post_type === 'manual' && viewerId != null && viewerId === r.author_id,
    reactionCounts: reactionCountsByPost.get(r.id) ?? { fire: 0, crown: 0, strong: 0, wow: 0 },
    myReaction: myReactionByPost.get(r.id) ?? null,
    commentCount: commentCountByPost.get(r.id) ?? 0,
    matchResult: r.reference_id ? (matchDetailById.get(r.reference_id) ?? null) : null,
  }))
}

const POST_SELECT =
  'id, author_id, content, image_url, post_type, reference_id, is_pinned, created_at, ' +
  `author:profiles!community_posts_author_id_fkey(${PROFILE_FIELDS})`

export interface FeedPage {
  pinned: PostView[]
  posts: PostView[]
  hasMore: boolean
}

// Pinned announcements always first (spec §4 "Feed order"), then the rest
// reverse-chronological, paginated. Pinned posts are fetched separately and
// excluded from the paginated set so "Load more" never re-shows them.
export async function fetchFeedPage(opts: { offset: number; limit: number; viewerId: string | null }): Promise<FeedPage> {
  const supabase = createClient()

  const [{ data: pinnedRows }, { data: rows }] = await Promise.all([
    supabase.from('community_posts').select(POST_SELECT).eq('is_deleted', false).eq('is_pinned', true).order('created_at', { ascending: false }),
    supabase
      .from('community_posts')
      .select(POST_SELECT)
      .eq('is_deleted', false)
      .eq('is_pinned', false)
      .order('created_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit), // fetch one extra to detect "has more"
  ])

  const rawRows = (rows ?? []) as unknown as RawPost[]
  const hasMore = rawRows.length > opts.limit
  const pageRows = hasMore ? rawRows.slice(0, opts.limit) : rawRows

  const [pinned, posts] = await Promise.all([
    hydratePosts((pinnedRows ?? []) as unknown as RawPost[], opts.viewerId),
    hydratePosts(pageRows, opts.viewerId),
  ])

  return { pinned, posts, hasMore }
}

export interface CommentView {
  id: string
  content: string
  createdAt: string
  author: PlayerRef
  canDelete: boolean
}

export async function fetchPostDetail(
  postId: string,
  viewerId: string | null,
): Promise<{ post: PostView; comments: CommentView[] } | null> {
  const supabase = createClient()
  const { data: postRow } = await supabase.from('community_posts').select(POST_SELECT).eq('id', postId).eq('is_deleted', false).maybeSingle()
  if (!postRow) return null
  const [post] = await hydratePosts([postRow as unknown as RawPost], viewerId)

  const { data: commentRows } = await supabase
    .from('post_comments')
    .select(`id, content, created_at, author_id, author:profiles!post_comments_author_id_fkey(${PROFILE_FIELDS})`)
    .eq('post_id', postId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(50) // spec §7: assume ≤ 50 comments per post, no pagination in Phase 3

  const comments: CommentView[] = ((commentRows ?? []) as unknown as {
    id: string
    content: string
    created_at: string
    author_id: string
    author: ProfileRef
  }[]).map((c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.created_at,
    author: toPlayerRef(firstProfile(c.author)),
    canDelete: viewerId != null && viewerId === c.author_id,
  }))

  return { post, comments }
}

export { REACTIONS }
