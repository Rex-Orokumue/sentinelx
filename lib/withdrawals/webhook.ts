import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { prizeKey } from '@/lib/notifications/keys'
import { formatNaira } from '@/lib/format'

export type TransferWebhookResult = 'applied' | 'noop' | 'not_found' | 'unknown_event'

// Pure decision: which withdrawal_requests.status a given Paystack transfer
// event should produce. No IO — unit tested directly.
export function transferEventTarget(event: string): 'paid' | 'failed' | null {
  if (event === 'transfer.success') return 'paid'
  if (event === 'transfer.failed' || event === 'transfer.reversed') return 'failed'
  return null
}

export async function applyTransferWebhook(
  reference: string,
  event: string,
  reason: string | null,
): Promise<TransferWebhookResult> {
  const target = transferEventTarget(event)
  if (!target) return 'unknown_event'

  const admin = createAdminClient()
  const { data: wr } = await admin
    .from('withdrawal_requests')
    .select('id, player_id, amount, status')
    .eq('paystack_transfer_reference', reference)
    .maybeSingle()
  if (!wr) return 'not_found'
  if (wr.status === target) return 'noop' // idempotent: Paystack may retry

  if (target === 'paid') {
    await admin
      .from('withdrawal_requests')
      .update({ status: 'paid', resolved_at: new Date().toISOString() })
      .eq('id', wr.id)
      .eq('status', 'processing')
    await notify({
      type: 'prize_credited',
      playerId: wr.player_id,
      dedupeKey: prizeKey(wr.id),
      amount: formatNaira(wr.amount),
    })
  } else {
    await admin
      .from('withdrawal_requests')
      .update({ status: 'failed', admin_note: reason ?? 'Transfer failed' })
      .eq('id', wr.id)
      .eq('status', 'processing')
  }

  return 'applied'
}
