'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { commentContentSchema } from './schema'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStaffIds } from '@/lib/admin/staff'
import { commentNotificationRecipients } from './comment-recipients'
import type { PostType } from './feed-query'

export type DeleteState = { error?: string } | undefined

export async function createComment(input: { postId: string; content: string }): Promise<{ id?: string; error?: string }> {
  const parsed = commentContentSchema.safeParse(input.content)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (!input.postId) return { error: 'Missing post.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to comment.' }

  const { data: comment, error } = await supabase
    .from('post_comments')
    .insert({ post_id: input.postId, author_id: user.id, content: parsed.data })
    .select('id')
    .single()
  if (error || !comment) {
    console.error('[createComment] post_comments insert failed', { postId: input.postId, authorId: user.id, code: error?.code, message: error?.message })
    return { error: 'Could not post your comment. Please try again.' }
  }

  const { data: post } = await supabase
    .from('community_posts')
    .select('author_id, content, post_type, reference_id')
    .eq('id', input.postId)
    .maybeSingle()

  if (post) {
    const admin = createAdminClient()

    // A match_result post has no author — it is system-generated — so the
    // people to tell are the two players whose match it reports. Fetched only
    // for that post type; every other type resolves without a second query.
    let matchPlayerIds: (string | null)[] = []
    if (post.post_type === 'match_result' && post.reference_id) {
      const { data: match } = await admin
        .from('matches')
        .select('player_a_id, player_b_id')
        .eq('id', post.reference_id)
        .maybeSingle()
      matchPlayerIds = [match?.player_a_id ?? null, match?.player_b_id ?? null]
    }

    // Announcements are author-less broadcasts, so a comment on one is staff
    // business.
    const staffIds = post.post_type === 'announcement' ? await getStaffIds(admin) : []

    const recipients = commentNotificationRecipients({
      postType: post.post_type as PostType,
      postAuthorId: post.author_id,
      matchPlayerIds,
      staffIds,
      commenterId: user.id,
    })

    const excerpt = parsed.data.length > 60 ? `${parsed.data.slice(0, 60)}…` : parsed.data
    const title = post.post_type === 'match_result' ? 'New comment on your match' : 'New comment'
    for (const recipientId of recipients) {
      void notifyInApp({
        playerId: recipientId,
        type: 'post_comment',
        title,
        body: excerpt,
        link: `/community/${input.postId}`,
      })
      void pushToPlayer(
        recipientId,
        'post_comment',
        { title, body: excerpt },
        { url: `/community/${input.postId}` },
      )
    }
  }

  revalidatePath(`/community/${input.postId}`)
  return { id: comment.id }
}

export async function deleteComment(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  const postId = String(formData.get('postId') ?? '')
  if (!id) return { error: 'Missing comment.' }
  const supabase = createClient()
  const { error } = await supabase.from('post_comments').update({ is_deleted: true }).eq('id', id)
  if (error) return { error: 'Could not delete this comment.' }
  if (postId) revalidatePath(`/community/${postId}`)
  return undefined
}
