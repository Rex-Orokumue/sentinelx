import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// Full-replace semantics, not an append log — the checklist represents current
// interest, not a click history. Session-scoped client: game_interest already grants
// authenticated users insert/delete on their own rows (048_game_interest.sql), no
// admin escalation needed.
//
// ORDER MATTERS: add the new set first, THEN prune everything else. The old
// delete-then-insert order meant an insert failure left the player with no interests
// at all, which for a player who completed onboarding breaks the "at least one game"
// rule. This way a failure at any point leaves the previous set, or a superset of it.
export async function replaceGameInterests(
  supabase: SupabaseClient<Database>,
  userId: string,
  gameIds: string[],
): Promise<{ ok: true } | { ok: false }> {
  const unique = Array.from(new Set(gameIds))
  if (unique.length === 0) {
    const { error } = await supabase.from('game_interest').delete().eq('user_id', userId)
    return error ? { ok: false } : { ok: true }
  }

  // ON CONFLICT DO NOTHING needs only the insert policy, no update policy.
  const { error: addError } = await supabase
    .from('game_interest')
    .upsert(
      unique.map((game_id) => ({ user_id: userId, game_id })),
      { onConflict: 'user_id,game_id', ignoreDuplicates: true },
    )
  if (addError) return { ok: false }

  // Callers pass zod-validated UUIDs, so interpolating them into the in() list is safe.
  const { error: pruneError } = await supabase
    .from('game_interest')
    .delete()
    .eq('user_id', userId)
    .not('game_id', 'in', '(' + unique.join(',') + ')')
  return pruneError ? { ok: false } : { ok: true }
}
