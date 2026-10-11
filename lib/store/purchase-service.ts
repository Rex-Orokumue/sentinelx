import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

type Admin = SupabaseClient<Database>

export type PurchaseResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'not_found' | 'inactive' | 'owned' | 'insufficient' | 'unavailable' | 'pending_deletion' }

// Buys one store item for `playerId`. The whole purchase (active check, ownership check, strict coin debit,
// ownership insert) happens in ONE database transaction (store_purchase), so a double tap or two devices
// can never charge twice or hand out an item on a stale balance. A database failure is `unavailable` and is
// never reported as "not enough coins".
export async function purchaseItem(admin: Admin, args: { playerId: string; itemId: string }): Promise<PurchaseResult> {
  // An account pending deletion must not take on new obligations.
  if (await assertNotPendingDeletion(admin, args.playerId)) return { ok: false, reason: 'pending_deletion' }
  try {
    const { data, error } = await admin.rpc('store_purchase', { p_player: args.playerId, p_item: args.itemId })
    if (error || !data) {
      console.error('[store] purchase failed', { message: error?.message })
      return { ok: false, reason: 'unavailable' }
    }
    const outcome = data as { status?: string; balance?: number }
    switch (outcome.status) {
      case 'ok':
        return typeof outcome.balance === 'number' ? { ok: true, balance: outcome.balance } : { ok: false, reason: 'unavailable' }
      case 'not_found':
      case 'inactive':
      case 'owned':
      case 'insufficient':
        return { ok: false, reason: outcome.status }
      default:
        return { ok: false, reason: 'unavailable' }
    }
  } catch (err) {
    console.error('[store] purchase threw', { message: err instanceof Error ? err.message : String(err) })
    return { ok: false, reason: 'unavailable' }
  }
}
