import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { notifyBoth } from '@/lib/notifications/send'
import { canFollow } from './predicates'

export type FollowClient = SupabaseClient<Database>

export type FollowErrorCode = 'self' | 'blocked' | 'error'
export type FollowResult = { ok: true; created: boolean } | { ok: false; code: FollowErrorCode }

export interface FollowDeps {
  // Fire-and-forget on the web action; the mobile endpoint collects the returned promise and awaits it
  // (serverless may freeze un-awaited work once the response is sent).
  notify: (...args: Parameters<typeof notifyBoth>) => unknown
}

// Runs on the CALLER's RLS client on purpose: the dm_blocks check in player_follows_own_insert is the
// block mechanism and must keep applying (never pass a service-role client here).
export async function followPlayer(
  client: FollowClient,
  followerId: string,
  targetId: string,
  deps: FollowDeps,
): Promise<FollowResult> {
  if (!canFollow(followerId, targetId).ok) return { ok: false, code: 'self' }

  // .select() after an ignoreDuplicates upsert returns a row only when the
  // insert actually happened (ON CONFLICT DO NOTHING returns nothing on a
  // no-op) — that's what tells a genuine new follow apart from a re-click on
  // an already-following state, so the new-follower notification below fires
  // once per real follow, not once per click.
  const { data: upserted, error } = await client
    .from('player_follows')
    .upsert({ follower_id: followerId, following_id: targetId }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
    .select('follower_id')
  // 42501 = RLS WITH CHECK failed — the only way that happens here is the
  // dm_blocks check in player_follows_own_insert.
  if (error) return { ok: false, code: error.code === '42501' ? 'blocked' : 'error' }

  const created = !!upserted && upserted.length > 0
  if (created) {
    const { data: me } = await client.from('profiles').select('display_name, username').eq('id', followerId).maybeSingle()
    const followerName = me?.display_name ?? me?.username ?? 'Someone'
    deps.notify(targetId, { type: 'new_follower', followerName }, 'new_follower', {
      link: me?.username ? `/players/${me.username}` : undefined,
    })
  }
  return { ok: true, created }
}

export async function unfollowPlayer(
  client: FollowClient,
  followerId: string,
  targetId: string,
): Promise<{ ok: true } | { ok: false; code: 'error' }> {
  const { error } = await client.from('player_follows').delete().eq('follower_id', followerId).eq('following_id', targetId)
  return error ? { ok: false, code: 'error' } : { ok: true }
}
