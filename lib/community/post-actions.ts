'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postContentSchema } from './schema'
import { incrementChallenge } from './challenges'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'

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

export type BoostState = { error?: string; success?: boolean } | undefined

const BOOST_COST_COINS = 200
const BOOST_DURATION_MS = 24 * 60 * 60 * 1000

// Spec §6: 200 coins pins one manual post the player authored to the top of
// the feed for 24h; only one active boost per player at a time. Goes
// through createAdminClient() throughout — community_posts has no
// player-facing UPDATE policy that would permit writing boosted_until
// directly (community_posts_player_delete's WITH CHECK requires
// is_deleted = true on the new row), same reason purchaseStoreItem
// (lib/coins/actions.ts) uses the admin client for its writes.
export async function boostPost(_prev: BoostState, formData: FormData): Promise<BoostState> {
  const postId = String(formData.get('id') ?? '')
  if (!postId) return { error: 'Missing post.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: post } = await admin
    .from('community_posts')
    .select('id, author_id, post_type, boosted_until')
    .eq('id', postId)
    .maybeSingle()
  if (!post || post.author_id !== user.id || post.post_type !== 'manual') {
    return { error: 'You can only boost your own post.' }
  }

  const now = new Date()
  if (post.boosted_until && new Date(post.boosted_until) > now) {
    return { error: 'This post is already boosted.' }
  }
  const { count: activeBoostCount } = await admin
    .from('community_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', user.id)
    .gt('boosted_until', now.toISOString())
  if (activeBoostCount && activeBoostCount > 0) {
    return { error: 'You already have an active boost on another post.' }
  }

  const balance = await getCoinBalance(admin, user.id)
  if (balance < BOOST_COST_COINS) return { error: 'Not enough SX Coins to boost.' }

  await recordCoinTransaction(admin, user.id, -BOOST_COST_COINS, 'post_boost', postId, 'Boosted a community post')
  const boostedUntil = new Date(now.getTime() + BOOST_DURATION_MS).toISOString()
  const { error } = await admin.from('community_posts').update({ boosted_until: boostedUntil }).eq('id', postId)
  if (error) {
    // Refund — mirrors purchaseStoreItem's already-owned rollback pattern.
    await recordCoinTransaction(admin, user.id, BOOST_COST_COINS, 'post_boost', postId, 'Boost failed — auto-reversed')
    return { error: 'Could not boost this post. Please try again.' }
  }

  revalidatePath('/community')
  return { success: true }
}
