import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { commentContentSchema } from './schema'
import { notifyBoth } from '@/lib/notifications/send'
import { getStaffIds } from '@/lib/admin/staff'
import { commentNotificationRecipients } from './comment-recipients'
import type { PostType } from './feed-query'

type Client = SupabaseClient<Database>
type Admin = ReturnType<typeof createAdminClient>

export type CreateCommentResult = { ok: true; id: string } | { ok: false; error: string; notFound?: boolean }

export async function performCreateComment(
  supabase: Client,
  admin: Admin,
  userId: string,
  input: { postId: string; content: string },
): Promise<CreateCommentResult> {
  const parsed = commentContentSchema.safeParse(input.content)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const { data: post } = await supabase.from('community_posts').select('author_id, content, post_type, reference_id').eq('id', input.postId).maybeSingle()
  if (!post) return { ok: false, error: 'Post not found.', notFound: true }

  const { data: comment, error } = await supabase
    .from('post_comments')
    .insert({ post_id: input.postId, author_id: userId, content: parsed.data })
    .select('id')
    .single()
  if (error || !comment) {
    console.error('[performCreateComment] post_comments insert failed', { postId: input.postId, authorId: userId, code: error?.code, message: error?.message })
    return { ok: false, error: 'Could not post your comment. Please try again.' }
  }

  let matchPlayerIds: (string | null)[] = []
  if (post.post_type === 'match_result' && post.reference_id) {
    const { data: match } = await admin.from('matches').select('player_a_id, player_b_id').eq('id', post.reference_id).maybeSingle()
    matchPlayerIds = [match?.player_a_id ?? null, match?.player_b_id ?? null]
  }
  const staffIds = post.post_type === 'announcement' ? await getStaffIds(admin) : []
  const recipients = commentNotificationRecipients({
    postType: post.post_type as PostType,
    postAuthorId: post.author_id,
    matchPlayerIds,
    staffIds,
    commenterId: userId,
  })
  const excerpt = parsed.data.length > 60 ? `${parsed.data.slice(0, 60)}…` : parsed.data
  for (const recipientId of recipients) {
    void notifyBoth(recipientId, { type: 'post_comment', onMatch: post.post_type === 'match_result', excerpt }, 'post_comment', {
      link: `/community/${input.postId}`,
      postId: input.postId,
    })
  }

  return { ok: true, id: comment.id }
}

export type DeleteCommentErrorCode = 'not_found' | 'forbidden'
export type DeleteCommentResult = { ok: true } | { ok: false; errorCode: DeleteCommentErrorCode }

export async function performDeleteComment(supabase: Client, userId: string, commentId: string): Promise<DeleteCommentResult> {
  const { data: row } = await supabase.from('post_comments').select('author_id, is_deleted').eq('id', commentId).maybeSingle()
  if (!row || row.is_deleted) return { ok: false, errorCode: 'not_found' }
  if (row.author_id !== userId) return { ok: false, errorCode: 'forbidden' }
  await supabase.from('post_comments').update({ is_deleted: true }).eq('id', commentId)
  return { ok: true }
}
