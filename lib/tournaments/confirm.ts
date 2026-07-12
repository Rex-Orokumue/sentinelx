import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { regKey } from '@/lib/notifications/keys'

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
    .select('id, payment_status, player_id, tournament:tournaments(title)')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.payment_status === 'paid') return 'already_paid'

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch (err) {
    // Surface the real cause in Vercel logs — a swallowed verify failure here
    // is indistinguishable from a genuinely failed payment otherwise.
    console.error('[confirmRegistration] Paystack verify failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    verify = null
  }

  const decision = decideConfirmation({ existing, verify })
  // already_paid is an expected, benign no-op — both the webhook and this
  // callback call confirmRegistration for the same reference by design.
  if (decision === 'not_successful') {
    console.error('[confirmRegistration] Paystack verify did not confirm the payment', {
      reference,
      verify,
    })
  }
  if (decision !== 'confirmed') return decision

  // Guard against races: only the pending → paid transition writes.
  await db
    .from('tournament_registrations')
    .update({ payment_status: 'paid' })
    .eq('id', existing.id)
    .eq('payment_status', 'pending')

  const tv = existing.tournament as { title: string } | { title: string }[] | null
  const tournamentTitle = (Array.isArray(tv) ? tv[0]?.title : tv?.title) ?? 'the tournament'
  await notify({
    type: 'registration_confirmed',
    playerId: existing.player_id,
    dedupeKey: regKey(existing.id),
    tournament: tournamentTitle,
  })

  return 'confirmed'
}
