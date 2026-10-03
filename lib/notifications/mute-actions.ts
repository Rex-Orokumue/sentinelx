'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MuteDuration } from './mutes'
import { clearPostMute, clearTypeMute, setPostMute, setTypeMute } from './mute-service'

export type MuteState = { error?: string; success?: string } | undefined

const DURATIONS: MuteDuration[] = ['1h', '1w', 'always']

function parseDuration(value: FormDataEntryValue | null): MuteDuration | null {
  const v = String(value ?? '')
  return (DURATIONS as string[]).includes(v) ? (v as MuteDuration) : null
}

// The mute logic itself lives in mute-service.ts so the mobile API (lib/mobile-api/endpoints/notifications.ts)
// and these actions do exactly the same thing.

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

  const result = await setPostMute(createAdminClient(), user.id, postId, duration)
  if (!result.ok) return { error: 'Could not mute this post.' }
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

  await clearPostMute(createAdminClient(), user.id, postId)
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

  const result = await setTypeMute(createAdminClient(), user.id, type, duration)
  if (!result.ok) {
    return { error: duration === 'always' ? 'Could not update your preferences.' : 'Could not mute these notifications.' }
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

  await clearTypeMute(createAdminClient(), user.id, type)

  revalidatePath('/dashboard/settings')
  return { success: 'Unmuted' }
}
