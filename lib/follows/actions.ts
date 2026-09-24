'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyBoth } from '@/lib/notifications/send'
import { canFollow } from './predicates'
import { followPlayer as follow, unfollowPlayer as unfollow } from './service'

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

  const r = await follow(supabase, userId, profileId, { notify: (...args) => void notifyBoth(...args) })
  if (!r.ok) {
    if (r.code === 'self') {
      const check = canFollow(userId, profileId)
      return { error: check.ok ? 'You cannot follow yourself.' : check.error }
    }
    return { error: r.code === 'blocked' ? 'You cannot follow this player.' : 'Could not follow this player.' }
  }

  revalidatePath('/community')
  return {}
}

export async function unfollowPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const r = await unfollow(supabase, userId, profileId)
  if (!r.ok) return { error: 'Could not unfollow this player.' }
  revalidatePath('/community')
  return {}
}
