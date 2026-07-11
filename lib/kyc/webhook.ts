import { createAdminClient } from '@/lib/supabase/admin'
import { createTransferRecipient } from '@/lib/paystack/server'

export type IdentificationWebhookResult = 'applied' | 'noop' | 'not_found' | 'unknown_event'

// Pure decision: which player_kyc.kyc_status a given Paystack identification
// event should produce. No IO — unit tested directly.
export function identificationEventTarget(event: string): 'verified' | 'failed' | null {
  if (event === 'customeridentification.success') return 'verified'
  if (event === 'customeridentification.failed') return 'failed'
  return null
}

export async function applyIdentificationWebhook(
  customerCode: string,
  event: string,
  reason: string | null,
): Promise<IdentificationWebhookResult> {
  const target = identificationEventTarget(event)
  if (!target) return 'unknown_event'

  const admin = createAdminClient()
  const { data: kyc } = await admin
    .from('player_kyc')
    .select('player_id, kyc_status, payout_bank_code, payout_account_number, payout_account_name')
    .eq('paystack_customer_code', customerCode)
    .maybeSingle()
  if (!kyc) return 'not_found'
  if (kyc.kyc_status === target) return 'noop' // idempotent: Paystack may retry

  if (target === 'verified') {
    try {
      const recipientCode = await createTransferRecipient({
        accountName: kyc.payout_account_name ?? '',
        accountNumber: kyc.payout_account_number ?? '',
        bankCode: kyc.payout_bank_code ?? '',
      })
      // Two explicit writes, not a trigger or computed column: player_kyc
      // (the authoritative state) and profiles.kyc_verified (the public,
      // non-sensitive "badge" boolean) are updated together right here so
      // they never drift apart.
      await admin
        .from('player_kyc')
        .update({
          kyc_status: 'verified',
          kyc_failure_reason: null,
          paystack_recipient_code: recipientCode,
        })
        .eq('player_id', kyc.player_id)
        .eq('kyc_status', 'pending')
      await admin.from('profiles').update({ kyc_verified: true }).eq('id', kyc.player_id)
    } catch {
      // BVN matched but recipient setup failed — surface as a failure so the
      // player can retry rather than being stuck "verified" with no payout route.
      await admin
        .from('player_kyc')
        .update({
          kyc_status: 'failed',
          kyc_failure_reason: 'Could not set up your payout account. Please try again.',
        })
        .eq('player_id', kyc.player_id)
        .eq('kyc_status', 'pending')
    }
  } else {
    await admin
      .from('player_kyc')
      .update({ kyc_status: 'failed', kyc_failure_reason: reason ?? 'Verification failed' })
      .eq('player_id', kyc.player_id)
      .eq('kyc_status', 'pending')
  }

  return 'applied'
}
