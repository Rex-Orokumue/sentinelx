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
} from './schema'
import { mapSignupError } from './errors'

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
  // Best-effort — a failed token cleanup must never block sign-out. Uses
  // the request-scoped client (not createAdminClient) so fcm_tokens_owner's
  // RLS policy (player_id = auth.uid()) does the scoping for us.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) await supabase.from('fcm_tokens').delete().eq('player_id', user.id)
  } catch {
    // ignore
  }
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
