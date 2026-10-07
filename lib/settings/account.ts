'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DeletionBlocker } from './deletion-guards'
import { performRequestDeletion, performCancelDeletion, performDeleteNow } from './deletion-flow'

export type DeleteAccountState = { error?: string; blockers?: DeletionBlocker[] } | undefined

// Starts the 15-day grace period. Nothing is destroyed here — the account is
// only marked, and the user can cancel right up until the cron executes it.
export async function requestAccountDeletion(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  if (formData.get('confirm') !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' }
  }
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performRequestDeletion(createAdminClient(), { id: user.id, email: user.email ?? null })
  if (!result.ok) {
    return result.reason === 'blocked'
      ? { blockers: result.blockers }
      : { error: 'Could not schedule deletion. Please try again.' }
  }
  // The banner renders from the nav session in the root layout.
  revalidatePath('/', 'layout')
  return undefined
}

export async function cancelAccountDeletion(): Promise<DeleteAccountState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performCancelDeletion(createAdminClient(), { id: user.id, email: user.email ?? null })
  if (!result.ok) return { error: 'Could not cancel. Please try again.' }
  revalidatePath('/', 'layout')
  return undefined
}

// Skips the grace period. Gated on typing the exact username rather than
// DELETE: a higher bar that works identically for password and Google
// accounts, since Google users have no password to re-enter. The final email
// still sends, so the account's real owner learns of it either way.
export async function deleteAccountNow(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performDeleteNow(createAdminClient(), user.id, String(formData.get('confirm') ?? ''))
  if (!result.ok) {
    return result.reason === 'blocked'
      ? { blockers: result.blockers }
      : { error: 'That does not match your username.' }
  }
  revalidatePath('/', 'layout')
  return undefined
}
