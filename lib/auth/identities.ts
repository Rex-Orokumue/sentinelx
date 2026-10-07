'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { verifyPassword } from './reauth'
import { supabaseSessionPort } from './account-auth-port'
import { performUnlinkGoogle, type UnlinkErrorCode } from './unlink-google-service'

// Codes rather than prose, matching changeEmail() — the settings section
// translates them. Wording lives in messages/*.json under `signInMethods`.
export type { UnlinkErrorCode }

export type UnlinkState = { errorCode?: UnlinkErrorCode; unlinked?: boolean } | undefined

// Removes the Google sign-in link from the current account.
//
// This exists because an email change does NOT revoke the old Google account's
// access: OAuth identities are keyed by the provider's stable subject ID, never
// by the email address, so the account that signed you up keeps working no
// matter what auth.users.email says afterwards.
//
// The checks and the order (password, identity count, provider, then revoking other
// sessions) live in performUnlinkGoogle, shared with DELETE /me/identities/google.
export async function unlinkGoogle(_prev: UnlinkState, formData: FormData): Promise<UnlinkState> {
  const password = String(formData.get('password') ?? '')
  if (!password) return { errorCode: 'password_required' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const result = await performUnlinkGoogle({
    port: supabaseSessionPort(supabase),
    user: { email: user?.email },
    password,
    verifyPassword,
  })
  if (!result.ok) return { errorCode: result.errorCode }

  revalidatePath('/dashboard/settings')
  return { unlinked: true }
}
