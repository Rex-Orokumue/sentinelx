'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { commentContentSchema } from './schema'
import { notifyInApp } from '@/lib/notifications/inbox'
import { pushToPlayer } from '@/lib/notifications/push'

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

  const { data: post } = await supabase.from('community_posts').select('author_id, content').eq('id', input.postId).maybeSingle()
  if (post?.author_id && post.author_id !== user.id) {
    const excerpt = parsed.data.length > 60 ? `${parsed.data.slice(0, 60)}…` : parsed.data
    void notifyInApp({
      playerId: post.author_id,
      type: 'post_comment',
      title: 'New comment',
      body: excerpt,
      link: `/community/${input.postId}`,
    })
    void pushToPlayer(
      post.author_id,
      'post_comment',
      { title: 'New comment', body: excerpt },
      { url: `/community/${input.postId}` },
    )
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
