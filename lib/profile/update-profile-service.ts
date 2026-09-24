import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ProfileEditInput } from './schema'

type Admin = ReturnType<typeof createAdminClient>

export type UpdateProfileErrorCode = 'username_taken' | 'username_locked' | 'save_failed'
export type UpdateProfileResult = { ok: true } | { ok: false; errorCode: UpdateProfileErrorCode }

// Extracted from lib/profile/actions.ts's updateProfile() — the Server
// Action and PATCH /me/profile both call this. No locale field: the real
// action never had one (spec S5.1's correction to the master catalogue).
export async function performUpdateProfile(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  input: ProfileEditInput & { avatarUrl?: string },
): Promise<UpdateProfileResult> {
  const avatarPatch = input.avatarUrl ? { avatar_url: input.avatarUrl } : {}

  let usernamePatch: { username?: string; username_changed_at?: string } = {}
  if (input.username) {
    const { data: current } = await supabase
      .from('profiles')
      .select('username, username_changed_at')
      .eq('id', userId)
      .maybeSingle()
    if (current && current.username !== input.username) {
      if (current.username_changed_at) return { ok: false, errorCode: 'username_locked' }
      usernamePatch = { username: input.username, username_changed_at: new Date().toISOString() }
    }
  }

  const { error } = await admin
    .from('profiles')
    .update({
      display_name: input.displayName,
      whatsapp_number: input.whatsapp || null,
      country: input.country || null,
      bio: input.bio || null,
      ...avatarPatch,
      ...usernamePatch,
    })
    .eq('id', userId)
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, errorCode: 'username_taken' }
    console.error('performUpdateProfile: update failed', error)
    return { ok: false, errorCode: 'save_failed' }
  }

  return { ok: true }
}
