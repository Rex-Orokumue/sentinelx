'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { verifyPassword } from './reauth'

// Codes rather than prose, matching changeEmail() — the settings section
// translates them. Wording lives in messages/*.json under `signInMethods`.
export type UnlinkErrorCode =
  | 'password_required'
  | 'not_logged_in'
  | 'wrong_password'
  | 'not_linked'
  | 'last_identity'
  | 'failed'

export type UnlinkState = { errorCode?: UnlinkErrorCode; unlinked?: boolean } | undefined

// Removes the Google sign-in link from the current account.
//
// This exists because an email change does NOT revoke the old Google account's
// access: OAuth identities are keyed by the provider's stable subject ID, never
// by the email address, so the account that signed you up keeps working no
// matter what auth.users.email says afterwards.
export async function unlinkGoogle(_prev: UnlinkState, formData: FormData): Promise<UnlinkState> {
  const password = String(formData.get('password') ?? '')
  if (!password) return { errorCode: 'password_required' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { errorCode: 'not_logged_in' }

  // The password does two jobs at once: it proves the session belongs to the
  // account holder (a borrowed session must not be able to strip someone's
  // sign-in method), and it proves a working password exists — so removing
  // Google cannot leave this account with no way back in.
  if (!(await verifyPassword(user.email, password))) return { errorCode: 'wrong_password' }

  const { data, error: identitiesError } = await supabase.auth.getUserIdentities()
  if (identitiesError || !data) {
    console.error('[unlinkGoogle] getUserIdentities failed', identitiesError)
    return { errorCode: 'failed' }
  }

  const google = data.identities.find((identity) => identity.provider === 'google')
  if (!google) return { errorCode: 'not_linked' }
  // Supabase refuses this as well; checking here is what lets us return a
  // translated message instead of surfacing a raw API error.
  if (data.identities.length < 2) return { errorCode: 'last_identity' }

  const { error } = await supabase.auth.unlinkIdentity(google)
  if (error) {
    console.error('[unlinkGoogle] unlinkIdentity failed', {
      code: (error as { code?: string }).code,
      message: error.message,
    })
    return { errorCode: 'failed' }
  }

  // Only after the link is actually gone. Unlinking is a "lock the other person
  // out" action, so their live session has to die with it — otherwise the
  // unlink changes nothing until their token happens to expire. Scope 'others'
  // leaves the current device signed in.
  await supabase.auth.signOut({ scope: 'others' })

  revalidatePath('/dashboard/settings')
  return { unlinked: true }
}
