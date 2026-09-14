'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyBoth } from '@/lib/notifications/send'
import { canFollow } from './predicates'

async function authed() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

export async function followPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const check = canFollow(userId, profileId)
  if (!check.ok) return { error: check.error }

  // .select() after an ignoreDuplicates upsert returns a row only when the
  // insert actually happened (ON CONFLICT DO NOTHING returns nothing on a
  // no-op) — that's what tells a genuine new follow apart from a re-click on
  // an already-following state, so the new-follower notification below fires
  // once per real follow, not once per click.
  const { data: upserted, error } = await supabase
    .from('player_follows')
    .upsert({ follower_id: userId, following_id: profileId }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
    .select('follower_id')
  // 42501 = RLS WITH CHECK failed — the only way that happens here is the
  // dm_blocks check in player_follows_own_insert.
  if (error) return { error: error.code === '42501' ? 'You cannot follow this player.' : 'Could not follow this player.' }

  if (upserted && upserted.length > 0) {
    const { data: me } = await supabase.from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
    const followerName = me?.display_name ?? me?.username ?? 'Someone'
    void notifyBoth(profileId, { type: 'new_follower', followerName }, 'new_follower', {
      link: me?.username ? `/players/${me.username}` : undefined,
    })
  }

  revalidatePath('/community')
  return {}
}

export async function unfollowPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const { error } = await supabase.from('player_follows').delete().eq('follower_id', userId).eq('following_id', profileId)
  if (error) return { error: 'Could not unfollow this player.' }
  revalidatePath('/community')
  return {}
}
