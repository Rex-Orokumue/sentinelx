'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { LOCALES } from '@/i18n/locales'
import {
  loginSchema,
  signupSchema,
  requestResetSchema,
  resetPasswordSchema,
  changeEmailSchema,
} from './schema'
import { mapSignupError } from './errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { isIdentifierBanned, isUsernameRetired } from './signup-blocks'
import { verifyPassword, hasPasswordIdentity } from './reauth'
import { DEVICE_TOKEN_COOKIE } from '@/lib/notifications/device-cookie'

// `needsConfirmation` is set by login() when the account exists but the email
// was never confirmed — the form then offers a "resend" button instead of the
// dead-end "invalid email or password".
export type ActionState = { error?: string; success?: string; needsConfirmation?: boolean } | undefined

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    if ((error as { code?: string }).code === 'email_not_confirmed') {
      return {
        error: "Your email isn't confirmed yet — check your inbox (and spam) for the link.",
        needsConfirmation: true,
      }
    }
    return { error: 'Invalid email or password.' }
  }

  revalidatePath('/', 'layout')
  redirect(safeNext(formData.get('next')))
}

export async function signup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    username: formData.get('username'),
    email: formData.get('email'),
    password: formData.get('password'),
    ref: formData.get('ref') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { username, email, password, ref } = parsed.data
  const supabase = createClient()

  // Ban evasion: only ever populated for accounts deleted while flagged for
  // cheating. The message is the same generic one used for other signup
  // failures — a distinct one would let anyone probe the blocklist for a
  // given address.
  const admin = createAdminClient()
  if (await isIdentifierBanned(admin, email)) {
    return { error: 'We could not create an account with those details.' }
  }
  // Checked here as well as at claim time: rejecting at the wizard is a far
  // better experience than accepting the signup and refusing the handle after
  // the user has confirmed their email.
  if (await isUsernameRetired(admin, username)) {
    return { error: 'That username is taken — try another.' }
  }

  // The username is NOT claimed here — see migration 073. It rides along as
  // signup metadata and is claimed after email confirmation at
  // /onboarding/username (which pre-fills from this value). Claiming it up
  // front meant an undelivered confirmation email locked the handle forever.
  // The wizard still shows a live availability hint, but it's advisory.

  // The email link format (token_hash + type + next) is controlled by the
  // Supabase "Confirm signup" template, which routes to /auth/confirm.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: ref ? { username, ref } : { username },
    },
  })
  if (error) {
    // Surface the real cause in Vercel logs — the user-facing message is
    // intentionally generic, so without this the root cause (e.g. an SMTP
    // send failure returning 500) is invisible outside the Supabase dashboard.
    console.error('[signup] supabase.auth.signUp failed', {
      email,
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
      message: error.message,
    })
    return { error: mapSignupError(error) }
  }

  // Seeds the new player's language from whatever they were browsing in —
  // see docs/superpowers/specs/2026-08-23-multi-language-support-design.md §5.
  const cookieLocale = cookies().get('NEXT_LOCALE')?.value
  const locale = LOCALES.includes(cookieLocale as (typeof LOCALES)[number]) ? cookieLocale : 'en'
  if (data.user) {
    await supabase.from('profiles').update({ locale }).eq('id', data.user.id)
  }

  return { success: 'check-email' }
}

// Re-send the signup confirmation link. Offered on the "check your email"
// screen and on login when the account exists but isn't confirmed. Neutral
// response regardless of whether the address maps to an unconfirmed account,
// and a send-rate-limit error is swallowed (the user just tried) — anything
// else is logged for Vercel.
export async function resendConfirmation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!z.string().email().safeParse(email).success) {
    return { error: 'Enter a valid email address.' }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error && (error as { code?: string }).code !== 'over_email_send_rate_limit') {
    console.error('[resendConfirmation] resend failed', {
      code: (error as { code?: string }).code,
      message: error.message,
    })
  }
  return {
    success:
      "If that address still needs confirming, a fresh link is on its way. Check your spam folder — and Google sign-in skips email entirely.",
  }
}

export async function requestReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  // The recovery link format (token_hash + type + next=/reset-password) is
  // controlled by the Supabase "Reset password" template → /auth/confirm.
  await supabase.auth.resetPasswordForEmail(parsed.data.email)
  // Neutral response regardless of whether the account exists.
  return { success: "If an account exists for that email, we've sent a reset link." }
}

// Codes rather than prose: the settings form translates them, the same way
// requestAccountDeletion's blockers are translated. Wording lives in
// messages/*.json under `emailChange`.
export type ChangeEmailErrorCode =
  | 'invalid_email'
  | 'password_required'
  | 'not_logged_in'
  | 'google_only'
  | 'same_email'
  | 'wrong_password'
  | 'email_banned'
  | 'email_in_use'
  | 'failed'

export type ChangeEmailState = { errorCode?: ChangeEmailErrorCode; sentTo?: string } | undefined

// Starts an email change. Supabase's "Secure email change" is OFF for this
// project, so exactly one link goes to the NEW address and the old inbox is
// never involved — deliberate, because the usual reason to change an address is
// that the old one is unreachable. The current password is what replaces the
// old inbox as proof of ownership, which is why it is required here and not on
// any other settings action.
//
// Nothing changes until the link is clicked: until then Supabase holds the
// address in user.new_email and auth.users.email is untouched.
//
// The link format (token_hash + type=email_change + next) is controlled by the
// Supabase "Change Email Address" template, which routes to /auth/confirm.
export async function changeEmail(
  _prev: ChangeEmailState,
  formData: FormData,
): Promise<ChangeEmailState> {
  const parsed = changeEmailSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0]
    return { errorCode: field === 'password' ? 'password_required' : 'invalid_email' }
  }

  const email = parsed.data.email.toLowerCase()
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { errorCode: 'not_logged_in' }

  // No password to re-enter. The way out is the existing password-reset flow,
  // whose link lands in the CURRENT inbox — so setting a password proves
  // ownership of the old address, which is the guarantee we would otherwise
  // have lost by not mailing it.
  if (!hasPasswordIdentity(user)) return { errorCode: 'google_only' }

  if (email === user.email.toLowerCase()) return { errorCode: 'same_email' }

  if (!(await verifyPassword(user.email, parsed.data.password))) {
    return { errorCode: 'wrong_password' }
  }

  // Ban evasion, same blocklist signup enforces: without this, an account could
  // simply walk onto an address that was banned for cheating.
  if (await isIdentifierBanned(createAdminClient(), email)) {
    return { errorCode: 'email_banned' }
  }

  const { error } = await supabase.auth.updateUser({ email })
  if (error) {
    const code = (error as { code?: string }).code
    // They asked seconds ago and a link is already in flight — reporting a
    // failure for something that just succeeded only causes a support message.
    if (code === 'over_email_send_rate_limit') return { sentTo: email }
    if (code === 'email_exists' || /already been registered/i.test(error.message)) {
      return { errorCode: 'email_in_use' }
    }
    console.error('[changeEmail] updateUser failed', {
      code,
      status: (error as { status?: number }).status,
      message: error.message,
    })
    return { errorCode: 'failed' }
  }

  // Repaints the settings page so the pending-address row appears without a
  // manual reload.
  revalidatePath('/dashboard/settings')
  return { sentTo: email }
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Your reset link has expired. Please request a new one.' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  const supabase = createClient()
  // Best-effort — a failed token cleanup must never block sign-out. Uses the
  // request-scoped client (not createAdminClient) so fcm_tokens_owner's RLS
  // policy (player_id = auth.uid()) does the scoping for us.
  //
  // Deletes ONLY this device's token. Every device has its own token stored
  // as its own row, so the previous `.eq('player_id', user.id)` matched all
  // of them: signing out on a laptop silently killed push on the player's
  // phone, with no indication and no way back but the Settings toggle.
  //
  // The token arrives via a cookie set by /api/notifications/fcm-token,
  // because signOut is a plain server action used directly as a form action
  // in three places and has no access to client state.
  try {
    const deviceToken = cookies().get(DEVICE_TOKEN_COOKIE)?.value
    if (deviceToken) {
      await supabase.from('fcm_tokens').delete().eq('token', deviceToken)
      cookies().delete(DEVICE_TOKEN_COOKIE)
    }
    // No cookie means a session predating this change. Deleting nothing is
    // the safe branch: the next sign-in on this browser re-upserts the same
    // token under the new player (onConflict: 'token'), so it self-corrects —
    // whereas deleting everything is the bug being fixed.
  } catch {
    // ignore
  }
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
