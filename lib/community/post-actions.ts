'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performCreatePost, performBoostPost } from './post-service'

export type DeleteState = { error?: string } | undefined

// A post needs text or an image, not neither (spec §6 "Empty post ... Post
// button disabled" — this is the server-side twin of that client check). Up
// to 5 images: the first is written to the legacy community_posts.image_url
// column (every existing reader — CommunityGallery, AnnouncementCard, admin —
// keeps working unchanged); the rest go to community_post_images. Core logic
// lives in post-service.ts (performCreatePost), shared with the mobile-api
// endpoint — this wrapper only derives the cookie-session client/user, same
// relationship as lib/tournaments/actions.ts to register-service.ts.
export async function createPost(input: { content: string; imageUrls?: string[] }): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to post.' }

  const result = await performCreatePost(supabase, createAdminClient(), user.id, input)
  if (!result.ok) return { error: result.error }
  revalidatePath('/community')
  return { id: result.id }
}

// NOT delegated to post-service.ts's performDeletePost: that function is
// author-only by design (Ruling 5 — mobile deliberately excludes the staff
// branch, left to Phase 8's own admin-scoped endpoint). This web action must
// keep permitting staff too, via community_posts_staff_manage RLS, so it
// stays a blind RLS-scoped update exactly as before rather than reusing the
// mobile-only ownership gate.
export async function deletePost(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing post.' }
  const supabase = createClient()
  const { error } = await supabase.from('community_posts').update({ is_deleted: true }).eq('id', id)
  if (error) return { error: 'Could not delete this post.' }
  revalidatePath('/community')
  revalidatePath(`/community/${id}`)
  return undefined
}

export type BoostState = { error?: string; success?: boolean } | undefined

// Spec §6: 200 coins pins one manual post the player authored to the top of
// the feed for 24h; only one active boost per player at a time. Core logic
// lives in post-service.ts (performBoostPost), shared with the mobile-api
// endpoint.
export async function boostPost(_prev: BoostState, formData: FormData): Promise<BoostState> {
  const postId = String(formData.get('id') ?? '')
  if (!postId) return { error: 'Missing post.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performBoostPost(createAdminClient(), user.id, postId)
  if (!result.ok) {
    const message: Record<typeof result.errorCode, string> = {
      not_found: 'You can only boost your own post.',
      already_boosted: 'This post is already boosted.',
      active_boost_exists: 'You already have an active boost on another post.',
      insufficient_coins: 'Not enough SX Coins to boost.',
      boost_failed: 'Could not boost this post. Please try again.',
    }
    return { error: message[result.errorCode] }
  }

  revalidatePath('/community')
  return { success: true }
}
