'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type DeleteAccountState = { error?: string } | undefined

// profiles.id REFERENCES auth.users(id) ON DELETE CASCADE (migration 001) —
// deleting the auth user cascades the profile row and everything FK'd to it.
// This is the only place in the codebase that calls auth.admin.deleteUser;
// there is no undo.
export async function deleteAccount(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  if (formData.get('confirm') !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' }
  }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    console.error('deleteAccount failed', error)
    return { error: 'Could not delete your account. Please try again or contact support.' }
  }
  return undefined
}
