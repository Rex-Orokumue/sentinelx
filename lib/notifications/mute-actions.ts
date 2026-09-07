'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { muteExpiryFor, type MuteDuration } from './mutes'

export type MuteState = { error?: string; success?: string } | undefined

const DURATIONS: MuteDuration[] = ['1h', '1w', 'always']

function parseDuration(value: FormDataEntryValue | null): MuteDuration | null {
  const v = String(value ?? '')
  return (DURATIONS as string[]).includes(v) ? (v as MuteDuration) : null
}

// Silences everything about one post — comments and reactions alike — for the
// chosen window. There is no per-post equivalent in notification_prefs, so
// "always" here is a far-future muted_until rather than a preference flip.
export async function mutePost(_prev: MuteState, formData: FormData): Promise<MuteState> {
  const postId = String(formData.get('postId') ?? '')
  const duration = parseDuration(formData.get('duration'))
  if (!postId || !duration) return { error: 'Missing post or duration.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { error } = await admin.from('notification_mutes').upsert(
    {
      player_id: user.id,
      post_id: postId,
      notification_type: null,
      muted_until: muteExpiryFor(duration, new Date()).toISOString(),
    },
    { onConflict: 'player_id,post_id' },
  )
  if (error) {
    console.error('[mute] mutePost failed', { postId, code: error.code, message: error.message })
    return { error: 'Could not mute this post.' }
  }
  revalidatePath(`/community/${postId}`)
  revalidatePath('/community')
  return { success: duration === 'always' ? 'Muted' : 'Muted for now' }
}

export async function unmutePost(_prev: MuteState, formData: FormData): Promise<MuteState> {
  const postId = String(formData.get('postId') ?? '')
  if (!postId) return { error: 'Missing post.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  await admin.from('notification_mutes').delete().eq('player_id', user.id).eq('post_id', postId)
  revalidatePath(`/community/${postId}`)
  revalidatePath('/community')
  return { success: 'Unmuted' }
}

// A timed mute writes a row; "always" instead flips
// notification_prefs.push[type], which already means exactly that. Keeping
// permanent state in one place stops the preference checkbox and the mute
// menu ever disagreeing about whether a type is on.
export async function muteType(_prev: MuteState, formData: FormData): Promise<MuteState> {
  const type = String(formData.get('type') ?? '')
  const duration = parseDuration(formData.get('duration'))
  if (!type || !duration) return { error: 'Missing type or duration.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()

  if (duration === 'always') {
    const { data: profile } = await admin
      .from('profiles')
      .select('notification_prefs')
      .eq('id', user.id)
      .maybeSingle()
    const prefs = (profile?.notification_prefs ?? {}) as Record<string, unknown>
    const push = { ...((prefs.push as Record<string, boolean>) ?? {}), [type]: false }
    const { error } = await admin
      .from('profiles')
      .update({ notification_prefs: { ...prefs, push } })
      .eq('id', user.id)
    if (error) return { error: 'Could not update your preferences.' }
    // A timed mute left over from before would now be redundant.
    await admin
      .from('notification_mutes')
      .delete()
      .eq('player_id', user.id)
      .eq('notification_type', type)
  } else {
    const { error } = await admin.from('notification_mutes').upsert(
      {
        player_id: user.id,
        notification_type: type,
        post_id: null,
        muted_until: muteExpiryFor(duration, new Date()).toISOString(),
      },
      { onConflict: 'player_id,notification_type' },
    )
    if (error) {
      console.error('[mute] muteType failed', { type, code: error.code, message: error.message })
      return { error: 'Could not mute these notifications.' }
    }
  }

  revalidatePath('/dashboard/settings')
  return { success: 'Muted' }
}

export async function unmuteType(_prev: MuteState, formData: FormData): Promise<MuteState> {
  const type = String(formData.get('type') ?? '')
  if (!type) return { error: 'Missing type.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  // Clear both representations — the row and, if it was an "always", the
  // preference flag — so one unmute always fully re-enables the type.
  await admin
    .from('notification_mutes')
    .delete()
    .eq('player_id', user.id)
    .eq('notification_type', type)

  const { data: profile } = await admin
    .from('profiles')
    .select('notification_prefs')
    .eq('id', user.id)
    .maybeSingle()
  const prefs = (profile?.notification_prefs ?? {}) as Record<string, unknown>
  const pushPrefs = (prefs.push as Record<string, boolean>) ?? {}
  if (pushPrefs[type] === false) {
    await admin
      .from('profiles')
      .update({ notification_prefs: { ...prefs, push: { ...pushPrefs, [type]: true } } })
      .eq('id', user.id)
  }

  revalidatePath('/dashboard/settings')
  return { success: 'Unmuted' }
}
