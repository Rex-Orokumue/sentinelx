'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { communityPostSchema, communityReplySchema } from './schema'

export type ReplyState = { error?: string; success?: boolean } | undefined
export type DeleteState = { error?: string } | undefined

// Called from the client composer with an already-uploaded image URL (if any).
export async function createPost(input: {
  gameId: string
  body: string
  imageUrl?: string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post.' }

  const parsed = communityPostSchema.safeParse({
    gameId: input.gameId,
    body: input.body,
    imageUrl: input.imageUrl ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({
      game_id: d.gameId,
      author_id: user.id,
      body: d.body,
      image_url: d.imageUrl || null,
    })
    .select('id')
    .single()
  if (error || !post) return { error: 'Could not post. Please try again.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return { id: post.id }
}

export async function createReply(_prev: ReplyState, formData: FormData): Promise<ReplyState> {
  const parsed = communityReplySchema.safeParse({
    postId: formData.get('postId'),
    body: formData.get('body'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to reply.' }

  const { error } = await supabase.from('community_replies').insert({
    post_id: parsed.data.postId,
    author_id: user.id,
    body: parsed.data.body,
  })
  if (error) return { error: 'Could not post your reply. Please try again.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return { success: true }
}

export async function deletePost(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing post.' }
  const supabase = createClient()
  // RLS permits the author or staff to delete; anyone else's DELETE affects 0 rows.
  const { error } = await supabase.from('community_posts').delete().eq('id', id)
  if (error) return { error: 'Could not delete this post.' }
  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}

export async function deleteReply(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing reply.' }
  const supabase = createClient()
  const { error } = await supabase.from('community_replies').delete().eq('id', id)
  if (error) return { error: 'Could not delete this reply.' }
  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}
