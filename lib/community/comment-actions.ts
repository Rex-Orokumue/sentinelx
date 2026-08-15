'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { commentContentSchema } from './schema'

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
