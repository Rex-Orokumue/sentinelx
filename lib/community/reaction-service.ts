import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ReactionType } from './schema'
import type { PostType } from './feed-query'
import { incrementChallenge } from './challenges'
import { notifyBoth } from '@/lib/notifications/send'
import { commentNotificationRecipients } from './comment-recipients'

type Client = SupabaseClient<Database>
type Admin = ReturnType<typeof createAdminClient>

async function notifyNewReaction(admin: Admin, postId: string, userId: string, reaction: ReactionType): Promise<void> {
  const { data: post } = await admin.from('community_posts').select('author_id, post_type, reference_id').eq('id', postId).maybeSingle()
  if (!post) return

  let matchPlayerIds: (string | null)[] = []
  if (post.post_type === 'match_result' && post.reference_id) {
    const { data: match } = await admin.from('matches').select('player_a_id, player_b_id').eq('id', post.reference_id).maybeSingle()
    matchPlayerIds = [match?.player_a_id ?? null, match?.player_b_id ?? null]
  }
  const recipients =
    post.post_type === 'announcement'
      ? []
      : commentNotificationRecipients({
          postType: post.post_type as PostType,
          postAuthorId: post.author_id,
          matchPlayerIds,
          staffIds: [],
          commenterId: userId,
        })
  for (const recipientId of recipients) {
    void notifyBoth(recipientId, { type: 'post_reaction', onMatch: post.post_type === 'match_result', reaction }, 'post_reaction', {
      link: `/community/${postId}`,
      postId,
    })
  }
}

export type ReactionErrorCode = 'not_found'
export type SetReactionResult = { ok: true; reaction: ReactionType } | { ok: false; errorCode: ReactionErrorCode }

// Ruling 6 (spec §4): a genuine PUT-to-set, not web's toggle — replaying the
// same reaction is a no-op (idempotency-safe), unlike toggleReaction
// (reaction-actions.ts), which is left untouched here for web's existing UX.
// A brand-new insert notifies + counts toward the "reactions_given" weekly
// challenge, same as toggleReaction's insert branch; switching an existing
// reaction to a different one does neither (already reacted to this post).
export async function performSetReaction(
  supabase: Client,
  admin: Admin,
  userId: string,
  postId: string,
  reaction: ReactionType,
): Promise<SetReactionResult> {
  const { data: post } = await supabase.from('community_posts').select('id').eq('id', postId).maybeSingle()
  if (!post) return { ok: false, errorCode: 'not_found' }

  const { data: existing } = await supabase.from('post_reactions').select('id, reaction').eq('post_id', postId).eq('player_id', userId).maybeSingle()

  if (existing?.reaction === reaction) return { ok: true, reaction }

  if (existing) {
    await supabase.from('post_reactions').update({ reaction }).eq('id', existing.id)
    return { ok: true, reaction }
  }

  await supabase.from('post_reactions').insert({ post_id: postId, player_id: userId, reaction })
  await incrementChallenge(admin, userId, 'reactions_given')
  await notifyNewReaction(admin, postId, userId, reaction)
  return { ok: true, reaction }
}

export async function performRemoveReaction(supabase: Client, userId: string, postId: string): Promise<{ ok: true }> {
  await supabase.from('post_reactions').delete().eq('post_id', postId).eq('player_id', userId)
  return { ok: true }
}
