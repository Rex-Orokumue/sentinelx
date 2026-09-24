import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// A tombstone has no public profile: its handle is retired, and the row
// exists only to keep match history and financial records attributable.
// Every caller (profile page, generateMetadata, followers/following pages,
// the mobile endpoints) shares this, so a stale link 404s instead of
// rendering an empty shell. Returns null when absent OR deleted.
// `cols` must include `deleted_at`.
export async function findLiveProfileByUsername<T extends { deleted_at: string | null }>(
  client: SupabaseClient<Database>,
  username: string,
  cols: string,
): Promise<T | null> {
  const { data } = await client.from('profiles').select(cols).eq('username', username).maybeSingle()
  const row = (data as unknown as T | null) ?? null
  if (row?.deleted_at) return null
  return row
}
