'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { profileEditSchema } from './schema'

export type ProfileEditState = { error?: string; success?: boolean } | undefined

export async function updateProfile(
  _prev: ProfileEditState,
  formData: FormData,
): Promise<ProfileEditState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const parsed = profileEditSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    username: formData.get('username') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
    country: formData.get('country') ?? '',
    bio: formData.get('bio') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const avatarUrl = formData.get('avatarUrl')
  const avatarPatch = typeof avatarUrl === 'string' && avatarUrl ? { avatar_url: avatarUrl } : {}

  // Username: server-side one-change enforcement (spec §6). A locked/unchanged
  // field submits '' and is skipped entirely — this branch only runs when the
  // player actually typed a new username.
  //
  // NOTE: username/username_changed_at were added in migration 062, applied
  // ahead of live-DB connectivity being restored (see plan Task 1) — the
  // generated lib/supabase/types.ts doesn't know about them yet, so the two
  // `as never`/cast points below are temporary until `npx supabase gen types`
  // is re-run against the applied migration (tracked in plan Task 13).
  let usernamePatch: { username?: string; username_changed_at?: string } = {}
  if (d.username) {
    const { data: current } = (await supabase
      .from('profiles')
      .select('username, username_changed_at')
      .eq('id', user.id)
      .maybeSingle()) as unknown as { data: { username: string; username_changed_at: string | null } | null }
    if (current && current.username !== d.username) {
      if (current.username_changed_at) {
        return { error: 'Username has already been changed once.' }
      }
      usernamePatch = { username: d.username, username_changed_at: new Date().toISOString() }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: d.displayName,
      whatsapp_number: d.whatsapp || null,
      country: d.country || null,
      bio: d.bio || null,
      ...avatarPatch,
      ...usernamePatch,
    } as never)
    .eq('id', user.id)
  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    console.error('updateProfile: update failed', error)
    return { error: 'Could not save your profile. Please try again.' }
  }

  await checkAndUnlockAchievements(createAdminClient(), user.id, { type: 'profile_updated' })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/settings')
  revalidatePath('/players/[username]', 'page')
  revalidatePath('/', 'layout')
  return { success: true }
}
