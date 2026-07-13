'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { communityPostSchema, communityReplySchema } from './schema'

export type DeleteState = { error?: string } | undefined

const MAX_IMAGES = 8

// Called from the client composer with already-uploaded image URLs (if any).
export async function createPost(input: {
  gameId: string
  body: string
  imageUrls?: string[]
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post.' }

  const parsed = communityPostSchema.safeParse({ gameId: input.gameId, body: input.body })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({ game_id: d.gameId, author_id: user.id, body: d.body })
    .select('id')
    .single()
  if (error || !post) return { error: 'Could not post. Please try again.' }

  const urls = (input.imageUrls ?? []).slice(0, MAX_IMAGES)
  if (urls.length > 0) {
    const rows = urls.map((url, i) => ({ post_id: post.id, image_url: url, display_order: i }))
    await supabase.from('community_post_images').insert(rows)
  }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return { id: post.id }
}

export async function createReply(input: {
  postId: string
  body: string
  imageUrls?: string[]
}): Promise<{ id?: string; error?: string }> {
  const parsed = communityReplySchema.safeParse({ postId: input.postId, body: input.body })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to reply.' }

  const { data: reply, error } = await supabase
    .from('community_replies')
    .insert({ post_id: parsed.data.postId, author_id: user.id, body: parsed.data.body })
    .select('id')
    .single()
  if (error || !reply) return { error: 'Could not post your reply. Please try again.' }

  const urls = (input.imageUrls ?? []).slice(0, MAX_IMAGES)
  if (urls.length > 0) {
    const rows = urls.map((url, i) => ({ reply_id: reply.id, image_url: url, display_order: i }))
    await supabase.from('community_reply_images').insert(rows)
  }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return { id: reply.id }
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
