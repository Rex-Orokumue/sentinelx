import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type ConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'

const EXPECTED_KOBO = REGISTRATION_FEE_NGN * 100

// Pure decision: given the current row status and Paystack's verify result,
// decide the outcome. No IO — unit tested directly.
export function decideConfirmation(args: {
  existing: { payment_status: string } | null
  verify: { status: string; amountKobo: number } | null
}): ConfirmResult {
  if (!args.existing) return 'not_found'
  if (args.existing.payment_status === 'paid') return 'already_paid'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  if (args.verify.amountKobo !== EXPECTED_KOBO) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook.
export async function confirmRegistration(reference: string): Promise<ConfirmResult> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('tournament_registrations')
    .select('id, payment_status')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.payment_status === 'paid') return 'already_paid'

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch {
    verify = null
  }

  const decision = decideConfirmation({ existing, verify })
  if (decision !== 'confirmed') return decision

  // Guard against races: only the pending → paid transition writes.
  await db
    .from('tournament_registrations')
    .update({ payment_status: 'paid' })
    .eq('id', existing.id)
    .eq('payment_status', 'pending')

  return 'confirmed'
}
