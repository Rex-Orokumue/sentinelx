'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performCreateComment } from './comment-service'

export type DeleteState = { error?: string } | undefined

// Core logic lives in comment-service.ts (performCreateComment), shared with
// the mobile-api endpoint — this wrapper only derives the cookie-session
// client/user, same relationship as lib/tournaments/actions.ts to
// register-service.ts.
export async function createComment(input: { postId: string; content: string }): Promise<{ id?: string; error?: string }> {
  if (!input.postId) return { error: 'Missing post.' }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to comment.' }

  const result = await performCreateComment(supabase, createAdminClient(), user.id, input)
  if (!result.ok) return { error: result.error }
  revalidatePath(`/community/${input.postId}`)
  return { id: result.id }
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
