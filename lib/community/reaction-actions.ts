'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reactionSchema, type ReactionType } from './schema'
import { incrementChallenge } from './challenges'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { commentNotificationRecipients } from './comment-recipients'
import type { PostType } from './feed-query'

export type ToggleReactionResult = { error?: string } | undefined

// One reaction per player per post (post_reactions UNIQUE(post_id, player_id)).
// Tapping the same reaction again removes it; tapping a different one
// replaces it (spec §5.1). Only a brand-new reaction (no prior row) counts
// toward the "Hype Man" weekly challenge — switching or removing a reaction
// on a post already reacted to isn't a new "react to a post".
export async function toggleReaction(postId: string, reaction: ReactionType): Promise<ToggleReactionResult> {
  const parsed = reactionSchema.safeParse(reaction)
  if (!parsed.success || !postId) return { error: 'Invalid reaction.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to react.' }

  const { data: existing } = await supabase
    .from('post_reactions')
    .select('id, reaction')
    .eq('post_id', postId)
    .eq('player_id', user.id)
    .maybeSingle()

  if (existing?.reaction === parsed.data) {
    const { error } = await supabase.from('post_reactions').delete().eq('id', existing.id)
    if (error) return { error: 'Could not update your reaction.' }
    return undefined
  }

  if (existing) {
    const { error } = await supabase.from('post_reactions').update({ reaction: parsed.data }).eq('id', existing.id)
    if (error) return { error: 'Could not update your reaction.' }
    return undefined
  }

  const { error } = await supabase.from('post_reactions').insert({ post_id: postId, player_id: user.id, reaction: parsed.data })
  if (error) return { error: 'Could not save your reaction.' }

  const admin = createAdminClient()
  await incrementChallenge(admin, user.id, 'reactions_given')

  const { data: post } = await admin
    .from('community_posts')
    .select('author_id, post_type, reference_id')
    .eq('id', postId)
    .maybeSingle()

  if (post) {
    // Same author-less problem as comments: every match_result post has
    // author_id NULL, so reactions on the bulk of the feed notified nobody.
    let matchPlayerIds: (string | null)[] = []
    if (post.post_type === 'match_result' && post.reference_id) {
      const { data: match } = await admin
        .from('matches')
        .select('player_a_id, player_b_id')
        .eq('id', post.reference_id)
        .maybeSingle()
      matchPlayerIds = [match?.player_a_id ?? null, match?.player_b_id ?? null]
    }
    // Reactions on an announcement are noise for staff — a broadcast getting
    // liked is not something anyone needs telling about.
    const recipients =
      post.post_type === 'announcement'
        ? []
        : commentNotificationRecipients({
            postType: post.post_type as PostType,
            postAuthorId: post.author_id,
            matchPlayerIds,
            staffIds: [],
            commenterId: user.id,
          })

    const title = post.post_type === 'match_result' ? 'New reaction on your match' : 'New reaction'
    const body = `Someone reacted ${parsed.data} to your post.`
    for (const recipientId of recipients) {
      void notifyInApp({
        playerId: recipientId,
        type: 'post_reaction',
        title,
        body,
        link: `/community/${postId}`,
      })
      void pushToPlayer(
        recipientId,
        { type: 'post_reaction', onMatch: post.post_type === 'match_result', reaction: parsed.data },
        { url: `/community/${postId}` },
        { postId },
      )
    }
  }
  return undefined
}
