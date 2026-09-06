import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { isPendingDeletion } from './grace'

export const RESTRICTION_MESSAGE =
  'Your account is scheduled for deletion. Cancel the deletion in Settings to do this.'

export function restrictionMessage(
  p: { deletion_requested_at: string | null; deleted_at: string | null } | null,
): string | null {
  if (p == null) return null
  return isPendingDeletion(p) ? RESTRICTION_MESSAGE : null
}

// An account pending deletion must not take on NEW obligations, or the guards
// that passed at request time no longer hold at execution — a user could join
// a tournament on day 3 and be deleted mid-bracket on day 15.
//
// Returns an error message, or null when the action may proceed.
export async function assertNotPendingDeletion(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('deletion_requested_at, deleted_at')
    .eq('id', playerId)
    .maybeSingle()
  return restrictionMessage(data ?? null)
}
