import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { isIdentifierBanned, isUsernameRetired } from './signup-blocks'
import { mapSignupError } from './errors'
import { LOCALES, type Locale } from '@/i18n/locales'

export interface SignupServiceInput {
  username: string
  email: string
  password: string
  ref?: string
  locale?: string
}

export type SignupServiceErrorCode =
  | 'blocked_details'
  | 'username_taken'
  | 'username_taken_go_back'
  | 'signup_failed'

export type SignupServiceResult = { ok: true } | { ok: false; errorCode: SignupServiceErrorCode }

// Extracted from lib/auth/actions.ts's signup() — the Server Action and
// POST /auth/signup both call this, so ban/retired-username/locale-seeding
// behavior can never drift between web and mobile.
export async function performSignup(
  authClient: SupabaseClient<Database>,
  admin: ReturnType<typeof createAdminClient>,
  input: SignupServiceInput,
): Promise<SignupServiceResult> {
  const { username, email, password, ref, locale: rawLocale } = input

  // Ban evasion: only ever populated for accounts deleted while flagged for
  // cheating. Generic error on purpose — a distinct one would let anyone
  // probe the blocklist for a given address.
  if (await isIdentifierBanned(admin, email)) {
    return { ok: false, errorCode: 'blocked_details' }
  }
  // Checked here as well as at claim time: rejecting at the wizard is a far
  // better experience than accepting the signup and refusing the handle
  // after the user has confirmed their email.
  if (await isUsernameRetired(admin, username)) {
    return { ok: false, errorCode: 'username_taken' }
  }

  // The username is NOT claimed here — see migration 073. It rides along as
  // signup metadata and is claimed after email confirmation at
  // /onboarding/username. The email link format (token_hash + type + next)
  // is controlled by the Supabase "Confirm signup" template → /auth/confirm.
  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: { data: ref ? { username, ref } : { username } },
  })
  if (error) {
    console.error('[performSignup] supabase.auth.signUp failed', {
      email,
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
      message: (error as { message?: string }).message,
    })
    return { ok: false, errorCode: mapSignupError(error) }
  }

  // Seeds the new player's language. profiles can only be written via the
  // service role since the S2 lock-down (20260918200000_...sql).
  const locale: Locale = LOCALES.includes(rawLocale as Locale) ? (rawLocale as Locale) : 'en'
  if (data.user) {
    await admin.from('profiles').update({ locale }).eq('id', data.user.id)
  }

  return { ok: true }
}
