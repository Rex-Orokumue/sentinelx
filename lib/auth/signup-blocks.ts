import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { hashIdentifier } from '@/lib/settings/identifier-hash'

type Admin = SupabaseClient<Database>

// A retired handle is permanently unavailable: /players/<username> is a
// permanent public URL and referral links are username-keyed, so reuse would
// point old links at a different person. Stored lowercase, so normalise here
// or a capitalised attempt sidesteps the block.
export async function isUsernameRetired(admin: Admin, username: string): Promise<boolean> {
  const { data } = await admin
    .from('retired_usernames')
    .select('username')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle()
  return data != null
}

// Only ever populated for accounts deleted while flagged for cheating.
export async function isIdentifierBanned(admin: Admin, value: string): Promise<boolean> {
  const { data } = await admin
    .from('banned_identifiers')
    .select('hash')
    .eq('hash', hashIdentifier(value, process.env.DELETION_HASH_PEPPER ?? ''))
    .maybeSingle()
  return data != null
}
