'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postContentSchema } from './schema'
import { incrementChallenge } from './challenges'

export type DeleteState = { error?: string } | undefined

// A post needs text or an image, not neither (spec §6 "Empty post ... Post
// button disabled" — this is the server-side twin of that client check).
export async function createPost(input: { content: string; imageUrl?: string | null }): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post.' }

  const parsed = postContentSchema.safeParse(input.content)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const content = parsed.data
  const imageUrl = input.imageUrl?.trim() || null
  if (!content && !imageUrl) return { error: 'Write something or add a screenshot first.' }

  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({ author_id: user.id, content, image_url: imageUrl, post_type: 'manual' })
    .select('id')
    .single()
  if (error || !post) {
    console.error('[createPost] community_posts insert failed', { authorId: user.id, code: error?.code, message: error?.message })
    return { error: 'Could not post. Please try again.' }
  }

  // Weekly "Community Voice" challenge — needs the service-role client since
  // player_challenge_progress has no client write policy (system-only writes).
  const admin = createAdminClient()
  await incrementChallenge(admin, user.id, 'post_created')

  revalidatePath('/community')
  return { id: post.id }
}

export async function deletePost(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing post.' }
  const supabase = createClient()
  // RLS permits the author (manual posts only) or staff; anyone else's UPDATE affects 0 rows.
  const { error } = await supabase.from('community_posts').update({ is_deleted: true }).eq('id', id)
  if (error) return { error: 'Could not delete this post.' }
  revalidatePath('/community')
  revalidatePath(`/community/${id}`)
  return undefined
}
