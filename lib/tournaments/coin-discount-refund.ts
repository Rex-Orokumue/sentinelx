import { recordCoinTransaction } from '@/lib/coins/service'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// A half-price registration (coins_used = 500) that never completed its
// Paystack checkout leaves a `pending` row holding a coin debit forever.
// Free-entry registrations (coins_used = 1,000) never reach `pending` — they
// confirm synchronously (see registerForTournament) — so this sweep only
// ever matches abandoned half-price checkouts. One hour mirrors the noshow
// sweep's cadence; a genuinely slow checkout can simply be retried, which
// mints a fresh reference at the (now undiscounted) full fee.
const ABANDON_WINDOW_MS = 60 * 60 * 1000

export async function refundAbandonedCoinDiscounts(admin: Admin, now: Date = new Date()): Promise<{ refunded: number }> {
  const cutoff = new Date(now.getTime() - ABANDON_WINDOW_MS).toISOString()
  const { data: stale } = await admin
    .from('tournament_registrations')
    .select('id, player_id, coins_used')
    .eq('payment_status', 'pending')
    .gt('coins_used', 0)
    .lt('registered_at', cutoff)
  const rows = stale ?? []

  for (const row of rows) {
    await recordCoinTransaction(admin, row.player_id, row.coins_used, 'entry_discount_refund', row.id, 'Abandoned checkout — coin discount refunded')
    await admin.from('tournament_registrations').update({ coins_used: 0, coin_discount_naira: 0 }).eq('id', row.id)
  }
  return { refunded: rows.length }
}
