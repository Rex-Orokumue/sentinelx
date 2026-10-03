import type { createAdminClient } from '@/lib/supabase/admin'
import { muteExpiryFor, type MuteDuration } from './mutes'

type Admin = ReturnType<typeof createAdminClient>

export type MuteSetResult = { ok: true } | { ok: false; error: 'failed' }

// Shared by the mobile endpoints and the web Server Actions in mute-actions.ts.

// A timed mute writes a row; "always" instead flips notification_prefs.push[type], which already means
// exactly that. Keeping permanent state in one place stops the preference checkbox and the mute menu ever
// disagreeing about whether a type is on. The flip goes through the atomic merge RPC (not a read-modify-write
// of the whole prefs object) so it cannot clobber a concurrent save of another section.
export async function setTypeMute(admin: Admin, userId: string, type: string, duration: MuteDuration): Promise<MuteSetResult> {
  if (duration === 'always') {
    const { error } = await admin.rpc('jsonb_merge_notification_prefs', {
      p_id: userId,
      p_key: 'push',
      p_patch: { [type]: false },
    })
    if (error) {
      console.error('[mute] setTypeMute(always) failed', { type, message: error.message })
      return { ok: false, error: 'failed' }
    }
    // A timed mute left over from before would now be redundant.
    await admin.from('notification_mutes').delete().eq('player_id', userId).eq('notification_type', type)
    return { ok: true }
  }
  const { error } = await admin.from('notification_mutes').upsert(
    {
      player_id: userId,
      notification_type: type,
      post_id: null,
      muted_until: muteExpiryFor(duration, new Date()).toISOString(),
    },
    { onConflict: 'player_id,notification_type' },
  )
  if (error) {
    console.error('[mute] setTypeMute failed', { type, code: error.code, message: error.message })
    return { ok: false, error: 'failed' }
  }
  return { ok: true }
}

// Clears both representations — the row and, if it was an "always", the preference flag — so one unmute
// always fully re-enables the type.
export async function clearTypeMute(admin: Admin, userId: string, type: string): Promise<void> {
  await admin.from('notification_mutes').delete().eq('player_id', userId).eq('notification_type', type)
  const { data: profile } = await admin.from('profiles').select('notification_prefs').eq('id', userId).maybeSingle()
  const push = ((profile?.notification_prefs ?? {}) as { push?: Record<string, unknown> }).push ?? {}
  if (push[type] === false) {
    await admin.rpc('jsonb_merge_notification_prefs', { p_id: userId, p_key: 'push', p_patch: { [type]: true } })
  }
}

// Silences everything about one post — comments and reactions alike. There is no per-post equivalent in
// notification_prefs, so "always" here is a far-future muted_until rather than a preference flip.
export async function setPostMute(admin: Admin, userId: string, postId: string, duration: MuteDuration): Promise<MuteSetResult> {
  const { error } = await admin.from('notification_mutes').upsert(
    {
      player_id: userId,
      post_id: postId,
      notification_type: null,
      muted_until: muteExpiryFor(duration, new Date()).toISOString(),
    },
    { onConflict: 'player_id,post_id' },
  )
  if (error) {
    console.error('[mute] setPostMute failed', { postId, code: error.code, message: error.message })
    return { ok: false, error: 'failed' }
  }
  return { ok: true }
}

export async function clearPostMute(admin: Admin, userId: string, postId: string): Promise<void> {
  await admin.from('notification_mutes').delete().eq('player_id', userId).eq('post_id', postId)
}

// Live (unexpired) rows only. A type muted "always" is not a row — it is push[type] === false, surfaced
// through the prefs read.
export async function listMutes(
  admin: Admin,
  userId: string,
  now: Date = new Date(),
): Promise<{ types: { type: string; mutedUntil: string }[]; posts: { postId: string; mutedUntil: string }[] }> {
  const { data } = await admin
    .from('notification_mutes')
    .select('notification_type, post_id, muted_until')
    .eq('player_id', userId)
    .gt('muted_until', now.toISOString())
  const types: { type: string; mutedUntil: string }[] = []
  const posts: { postId: string; mutedUntil: string }[] = []
  for (const r of (data ?? []) as { notification_type: string | null; post_id: string | null; muted_until: string }[]) {
    if (r.notification_type) types.push({ type: r.notification_type, mutedUntil: r.muted_until })
    else if (r.post_id) posts.push({ postId: r.post_id, mutedUntil: r.muted_until })
  }
  return { types, posts }
}
