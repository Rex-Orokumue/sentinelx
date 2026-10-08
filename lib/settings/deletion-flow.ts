import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { checkCanDelete, type DeletionBlocker } from './deletion-guards'
import { fetchGuardInput, executeDeletion } from './deletion-service'
import { deletionDueAt } from './grace'
import { sendEmail } from '@/lib/email/send'
import { SITE_URL } from '@/lib/seo/site'

type Admin = SupabaseClient<Database>
const SETTINGS_URL = `${SITE_URL}/dashboard/settings`

export type RequestDeletionOutcome =
  | { ok: true; requestedAt: Date; dueAt: Date }
  | { ok: false; reason: 'blocked'; blockers: DeletionBlocker[] }
  | { ok: false; reason: 'save_failed' }

// Starts the 15-day grace period. Nothing is destroyed here: the account is only marked, and
// the user can cancel right up until the cron executes it. Extracted from account.ts
// requestAccountDeletion(); the action keeps the typed-DELETE check and revalidation.
export async function performRequestDeletion(
  admin: Admin,
  user: { id: string; email: string | null },
  now: Date = new Date(),
): Promise<RequestDeletionOutcome> {
  const blockers = checkCanDelete(await fetchGuardInput(admin, user.id))
  if (blockers.length > 0) return { ok: false, reason: 'blocked', blockers }

  const { error } = await admin.from('profiles').update({ deletion_requested_at: now.toISOString() }).eq('id', user.id)
  if (error) {
    console.error('requestAccountDeletion failed', error)
    return { ok: false, reason: 'save_failed' }
  }

  const due = deletionDueAt(now)
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
  return { ok: true, requestedAt: now, dueAt: due }
}

export async function performCancelDeletion(
  admin: Admin,
  user: { id: string; email: string | null },
): Promise<{ ok: true } | { ok: false }> {
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', user.id)
    .is('deleted_at', null)
  if (error) {
    console.error('cancelAccountDeletion failed', error)
    return { ok: false }
  }
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account deletion was cancelled',
      html: '<p>Your account is no longer scheduled for deletion. Nothing was lost.</p>',
    })
  }
  return { ok: true }
}

export type DeleteNowOutcome =
  | { ok: true }
  | { ok: false; reason: 'username_mismatch' }
  | { ok: false; reason: 'blocked'; blockers: DeletionBlocker[] }

// Skips the grace period. Gated on typing the exact username (case-insensitive, trimmed): a
// higher bar than DELETE that works identically for password and Google accounts.
export async function performDeleteNow(admin: Admin, userId: string, typedUsername: string): Promise<DeleteNowOutcome> {
  const { data: profile } = await admin.from('profiles').select('username').eq('id', userId).maybeSingle()
  const typed = typedUsername.trim()
  if (!profile?.username || typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { ok: false, reason: 'username_mismatch' }
  }
  const result = await executeDeletion(admin, userId)
  if (!result.ok) return { ok: false, reason: 'blocked', blockers: result.blockers }
  return { ok: true }
}
