'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  loginSchema,
  signupSchema,
  requestResetSchema,
  resetPasswordSchema,
} from './schema'
import { mapSignupError } from './errors'

export type ActionState = { error?: string; success?: string } | undefined

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
  if (error) return { error: 'Invalid email or password.' }

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

  // Precise username-availability check before signUp. `profiles` is
  // publicly readable (profiles_public_read) and username uniqueness is
  // case-sensitive (`username text UNIQUE`), so an exact match mirrors the
  // DB constraint. This is the primary path — the constraint itself remains
  // the backstop for the rare check-then-insert race.
  const { data: existing, error: lookupError } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (lookupError) {
    // Fail open: don't block signup on a lookup hiccup — the UNIQUE
    // constraint still protects us. Log so it's visible in Vercel logs.
    console.error('[signup] username availability check failed', {
      code: lookupError.code,
      message: lookupError.message,
    })
  } else if (existing) {
    return { error: 'That username is taken — go back and pick another.' }
  }

  // The email link format (token_hash + type + next) is controlled by the
  // Supabase "Confirm signup" template, which routes to /auth/confirm.
  const { error } = await supabase.auth.signUp({
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

  return { success: 'check-email' }
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
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
