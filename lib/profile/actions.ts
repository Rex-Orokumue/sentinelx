'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { profileEditSchema } from './schema'
import { performUpdateProfile, type UpdateProfileErrorCode } from './update-profile-service'

export type ProfileEditState = { error?: string; success?: boolean } | undefined

const ERROR_MESSAGES: Record<UpdateProfileErrorCode, string> = {
  username_taken: 'That username is already taken.',
  username_locked: 'Username has already been changed once.',
  save_failed: 'Could not save your profile. Please try again.',
}

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

  const avatarUrl = formData.get('avatarUrl')
  const avatarUrlStr = typeof avatarUrl === 'string' && avatarUrl ? avatarUrl : undefined

  const result = await performUpdateProfile(supabase, createAdminClient(), user.id, { ...parsed.data, avatarUrl: avatarUrlStr })
  if (!result.ok) return { error: ERROR_MESSAGES[result.errorCode] }

  await checkAndUnlockAchievements(createAdminClient(), user.id, { type: 'profile_updated' })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/settings')
  revalidatePath('/players/[username]', 'page')
  revalidatePath('/', 'layout')
  return { success: true }
}
