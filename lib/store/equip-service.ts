import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export type EquipResult =
  | { ok: true; category: string }
  | { ok: false; reason: 'not_found' | 'not_owned' | 'unavailable' }

// Equips or unequips one OWNED item. Equipping swaps the whole category in one statement (store_equip), so a
// failure can never leave a category with nothing equipped. The existing triggers keep profiles.equipped_*
// in sync for unequip as well.
export async function setItemEquipped(admin: Admin, args: { playerId: string; itemId: string; equipped: boolean }): Promise<EquipResult> {
  try {
    const { data, error } = await admin.rpc('store_equip', { p_player: args.playerId, p_item: args.itemId, p_equipped: args.equipped })
    if (error || !data) {
      console.error('[store] equip failed', { message: error?.message })
      return { ok: false, reason: 'unavailable' }
    }
    const outcome = data as { status?: string; category?: string }
    if (outcome.status === 'ok' && typeof outcome.category === 'string') return { ok: true, category: outcome.category }
    if (outcome.status === 'not_found' || outcome.status === 'not_owned') return { ok: false, reason: outcome.status }
    return { ok: false, reason: 'unavailable' }
  } catch (err) {
    console.error('[store] equip threw', { message: err instanceof Error ? err.message : String(err) })
    return { ok: false, reason: 'unavailable' }
  }
}
