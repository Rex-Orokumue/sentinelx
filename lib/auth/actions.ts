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
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { username, email, password } = parsed.data
  const supabase = createClient()
  // The email link format (token_hash + type + next) is controlled by the
  // Supabase "Confirm signup" template, which routes to /auth/confirm.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
    },
  })
  if (error) return { error: mapSignupError(error) }

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
