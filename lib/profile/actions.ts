'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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
    whatsapp: formData.get('whatsapp') ?? '',
    country: formData.get('country') ?? '',
    bio: formData.get('bio') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const avatarUrl = formData.get('avatarUrl')

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: d.displayName,
      whatsapp_number: d.whatsapp || null,
      country: d.country || null,
      bio: d.bio || null,
      ...(typeof avatarUrl === 'string' && avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq('id', user.id)
  if (error) {
    console.error('updateProfile: update failed', error)
    return { error: 'Could not save your profile. Please try again.' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/players/[username]', 'page')
  revalidatePath('/', 'layout')
  return { success: true }
}
