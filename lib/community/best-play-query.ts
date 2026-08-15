import { createClient } from '@/lib/supabase/server'
import { currentWeekStart } from './challenges'

// Voting window: Friday 9AM WAT through Sunday 9PM WAT of the nomination's
// week (spec §9). Nominations are created Friday morning for the week that
// just played out; the banner only shows during that window.
export function isVotingWindowOpen(now: Date = new Date()): boolean {
  const wat = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const day = wat.getDay() // 0 Sun .. 6 Sat
  const hour = wat.getHours()
  if (day === 5) return hour >= 9 // Friday from 9am
  if (day === 6) return true // all Saturday
  if (day === 0) return hour < 21 // Sunday until 9pm
  return false
}

export interface BestPlayNominationView {
  nominationId: string
  postId: string
  content: string
  authorName: string
  voteCount: number
}

export async function fetchBestPlayBanner(
  viewerId: string | null,
): Promise<{ nominations: BestPlayNominationView[]; myVoteNominationId: string | null } | null> {
  if (!isVotingWindowOpen()) return null
  const supabase = createClient()
  const weekStart = currentWeekStart()

  const { data: nominations } = await supabase
    .from('best_play_nominations')
    .select('id, post_id, post:community_posts(content, author:profiles!community_posts_author_id_fkey(display_name, username))')
    .eq('week_start', weekStart)
    .eq('is_winner', false)
  if (!nominations || nominations.length === 0) return null

  const nominationIds = nominations.map((n) => n.id)
  const { data: votes } = await supabase.from('best_play_votes').select('nomination_id, player_id').in('nomination_id', nominationIds)

  const voteCountByNomination = new Map<string, number>()
  let myVoteNominationId: string | null = null
  for (const v of votes ?? []) {
    voteCountByNomination.set(v.nomination_id, (voteCountByNomination.get(v.nomination_id) ?? 0) + 1)
    if (viewerId && v.player_id === viewerId) myVoteNominationId = v.nomination_id
  }

  type PostRef = { content: string; author: { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null }
  return {
    myVoteNominationId,
    nominations: nominations.map((n) => {
      const post = (Array.isArray(n.post) ? n.post[0] : n.post) as PostRef | null
      const author = post ? (Array.isArray(post.author) ? post.author[0] : post.author) : null
      return {
        nominationId: n.id,
        postId: n.post_id,
        content: post?.content ?? '',
        authorName: author?.display_name ?? author?.username ?? 'A player',
        voteCount: voteCountByNomination.get(n.id) ?? 0,
      }
    }),
  }
}
