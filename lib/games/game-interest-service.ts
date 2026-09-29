import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// Full-replace semantics (delete-then-insert), not an append log — the
// checklist represents current interest, not a click history. Session-scoped
// client: game_interest already grants authenticated users insert/delete on
// their own rows (048_game_interest.sql), no admin escalation needed.
export async function replaceGameInterests(
  supabase: SupabaseClient<Database>,
  userId: string,
  gameIds: string[],
): Promise<{ ok: true } | { ok: false }> {
  const { error: delError } = await supabase.from('game_interest').delete().eq('user_id', userId)
  if (delError) return { ok: false }
  if (gameIds.length === 0) return { ok: true }
  const { error: insError } = await supabase
    .from('game_interest')
    .insert(gameIds.map((game_id) => ({ user_id: userId, game_id })))
  return insError ? { ok: false } : { ok: true }
}
