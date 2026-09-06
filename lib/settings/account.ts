'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkCanDelete, type DeletionBlocker } from './deletion-guards'
import { fetchGuardInput, executeDeletion } from './deletion-service'
import { deletionDueAt } from './grace'
import { sendEmail } from '@/lib/email/send'
import { SITE_URL } from '@/lib/seo/site'

export type DeleteAccountState = { error?: string; blockers?: DeletionBlocker[] } | undefined

const SETTINGS_URL = `${SITE_URL}/dashboard/settings`

// Starts the 15-day grace period. Nothing is destroyed here — the account is
// only marked, and the user can cancel right up until the cron executes it.
export async function requestAccountDeletion(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  if (formData.get('confirm') !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' }
  }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const blockers = checkCanDelete(await fetchGuardInput(admin, user.id))
  if (blockers.length > 0) return { blockers }

  const requestedAt = new Date()
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: requestedAt.toISOString() })
    .eq('id', user.id)
  if (error) {
    console.error('requestAccountDeletion failed', error)
    return { error: 'Could not schedule deletion. Please try again.' }
  }

  const due = deletionDueAt(requestedAt)
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account is scheduled for deletion',
      html:
        `<p>Your SentinelX Esports account is scheduled for deletion on ` +
        `<strong>${due.toDateString()}</strong>.</p>` +
        `<p>If you did not ask for this, or you change your mind, sign in and cancel: ` +
        `<a href="${SETTINGS_URL}">${SETTINGS_URL}</a></p>`,
    })
  }
  // The banner renders from the nav session in the root layout.
  revalidatePath('/', 'layout')
  return undefined
}

export async function cancelAccountDeletion(): Promise<DeleteAccountState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', user.id)
    .is('deleted_at', null)
  if (error) {
    console.error('cancelAccountDeletion failed', error)
    return { error: 'Could not cancel. Please try again.' }
  }
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account deletion was cancelled',
      html: '<p>Your account is no longer scheduled for deletion. Nothing was lost.</p>',
    })
  }
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
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  const typed = String(formData.get('confirm') ?? '').trim()
  if (!profile?.username || typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { error: 'That does not match your username.' }
  }

  const result = await executeDeletion(admin, user.id)
  if (!result.ok) return { blockers: result.blockers }
  revalidatePath('/', 'layout')
  return undefined
}
