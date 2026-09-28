import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { isBoostLive, BOOST_DURATION_MS } from './boost'
import { postContentSchema, clampImageUrls } from './schema'
import { incrementChallenge } from './challenges'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'

type Client = SupabaseClient<Database>
type Admin = ReturnType<typeof createAdminClient>

const BOOST_COST_COINS = 200

// Injectable core shared by the web Server Action (post-actions.ts, which
// derives `supabase`/`admin`/`userId` from the request's cookie session) and
// the mobile-api endpoint (which derives them from the bearer token via
// ctx.userClient/ctx.admin/ctx.userId) — same shape as
// lib/tournaments/register-service.ts's relationship to actions.ts.
export async function performCreatePost(
  supabase: Client,
  admin: Admin,
  userId: string,
  input: { content: string; imageUrls?: string[] },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = postContentSchema.safeParse(input.content)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const content = parsed.data
  const imageUrls = clampImageUrls(input.imageUrls ?? [])
  const firstImageUrl = imageUrls[0] ?? null
  if (!content && !firstImageUrl) return { ok: false, error: 'Write something or add a screenshot first.' }

  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({ author_id: userId, content, image_url: firstImageUrl, post_type: 'manual' })
    .select('id')
    .single()
  if (error || !post) {
    console.error('[performCreatePost] community_posts insert failed', { authorId: userId, code: error?.code, message: error?.message })
    return { ok: false, error: 'Could not post. Please try again.' }
  }

  if (imageUrls.length > 1) {
    const extraImages = imageUrls.slice(1).map((image_url, i) => ({ post_id: post.id, image_url, display_order: i + 1 }))
    const { error: imagesError } = await supabase.from('community_post_images').insert(extraImages)
    if (imagesError) {
      console.error('[performCreatePost] community_post_images insert failed', { postId: post.id, code: imagesError.code, message: imagesError.message })
    }
  }

  await incrementChallenge(admin, userId, 'post_created')
  return { ok: true, id: post.id }
}

export type DeletePostErrorCode = 'not_found' | 'forbidden'
export type DeletePostResult = { ok: true } | { ok: false; errorCode: DeletePostErrorCode }

export async function performDeletePost(supabase: Client, userId: string, postId: string): Promise<DeletePostResult> {
  const { data: row } = await supabase.from('community_posts').select('author_id, is_deleted').eq('id', postId).maybeSingle()
  if (!row || row.is_deleted) return { ok: false, errorCode: 'not_found' }
  if (row.author_id !== userId) return { ok: false, errorCode: 'forbidden' }
  const { error } = await supabase.from('community_posts').update({ is_deleted: true }).eq('id', postId)
  if (error) return { ok: false, errorCode: 'not_found' }
  return { ok: true }
}

export type BoostPostErrorCode = 'not_found' | 'already_boosted' | 'active_boost_exists' | 'insufficient_coins' | 'boost_failed'
export type BoostPostResult = { ok: true } | { ok: false; errorCode: BoostPostErrorCode }

// Extracted from boostPost (post-actions.ts) per spec §4 — mirrors
// performPlaceWager's shape (lib/wagers/place-wager-service.ts): pulls the
// coin-spend + refund-on-write-failure logic out so the mobile endpoint
// handler stays a thin wrapper, matching wager.ts's own pattern. Takes only
// `admin`, not the caller's RLS-scoped client — every community_posts write
// here goes through the service role (see the original boostPost's own
// comment: no player-facing UPDATE policy permits writing boosted_until
// directly), same as the code it was extracted from.
export async function performBoostPost(admin: Admin, userId: string, postId: string): Promise<BoostPostResult> {
  const { data: post } = await admin
    .from('community_posts')
    .select('id, author_id, post_type, boosted_until')
    .eq('id', postId)
    .maybeSingle()
  if (!post || post.author_id !== userId || post.post_type !== 'manual') return { ok: false, errorCode: 'not_found' }

  const now = new Date()
  if (isBoostLive(post.boosted_until, now)) return { ok: false, errorCode: 'already_boosted' }

  const { count: activeBoostCount } = await admin
    .from('community_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', userId)
    .gt('boosted_until', now.toISOString())
  if (activeBoostCount && activeBoostCount > 0) return { ok: false, errorCode: 'active_boost_exists' }

  const balance = await getCoinBalance(admin, userId)
  if (balance < BOOST_COST_COINS) return { ok: false, errorCode: 'insufficient_coins' }

  await recordCoinTransaction(admin, userId, -BOOST_COST_COINS, 'post_boost', postId, 'Boosted a community post')
  const boostedUntil = new Date(now.getTime() + BOOST_DURATION_MS).toISOString()
  const { error } = await admin.from('community_posts').update({ boosted_until: boostedUntil }).eq('id', postId)
  if (error) {
    await recordCoinTransaction(admin, userId, BOOST_COST_COINS, 'post_boost', postId, 'Boost failed — auto-reversed')
    return { ok: false, errorCode: 'boost_failed' }
  }
  return { ok: true }
}
