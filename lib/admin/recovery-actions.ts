'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { hashIdentifier } from '@/lib/settings/identifier-hash'

export type RecoveryState = { error?: string; success?: string } | undefined

// Admin, not moderator: releasing a handle or lifting a cheat sanction are
// identity decisions, and moderators already hold no ban powers.
export async function releaseUsername(
  _prev: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const ctx = await requireAdmin()
  const username = String(formData.get('username') ?? '').trim().toLowerCase()
  if (!username) return { error: 'Enter a username.' }

  const admin = createAdminClient()
  const { data } = await admin
    .from('retired_usernames')
    .delete()
    .eq('username', username)
    .select('username')
  if (!data || data.length === 0) return { error: 'That username is not retired.' }

  await admin.from('admin_recovery_log').insert({
    actor_id: ctx.userId,
    action: 'release_username',
    target: username,
  })
  revalidatePath('/admin/account-recovery')
  return {
    success: `${username} is claimable again — by anyone, not only its previous owner.`,
  }
}

export async function clearBannedIdentifier(
  _prev: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const ctx = await requireAdmin()
  const value = String(formData.get('value') ?? '').trim()
  if (!value) return { error: 'Enter an email address or phone number.' }

  const admin = createAdminClient()
  // The stored hash cannot be reversed, so the plaintext is hashed and matched
  // rather than searched for.
  const hash = hashIdentifier(value, process.env.DELETION_HASH_PEPPER ?? '')
  const { data } = await admin
    .from('banned_identifiers')
    .delete()
    .eq('hash', hash)
    .select('hash')
  if (!data || data.length === 0) return { error: 'No ban is recorded for that value.' }

  // The hash, never the plaintext — logging the address would reintroduce the
  // personal data this design removed.
  await admin.from('admin_recovery_log').insert({
    actor_id: ctx.userId,
    action: 'clear_identifier',
    target: hash,
  })
  revalidatePath('/admin/account-recovery')
  return { success: 'That identifier can register again.' }
}
