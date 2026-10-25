import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications/notify'
import { regKey } from '@/lib/notifications/keys'
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
import { finalizeSquadJoin } from './squad-membership'

export type ConfirmResult = 'confirmed' | 'already_paid' | 'overpayment_credited' | 'not_found' | 'not_successful'

type Admin = ReturnType<typeof createAdminClient>

export async function confirmInvitationAttempt(db: Admin, reference: string): Promise<ConfirmResult> {
  let verify: { status: string; amountKobo: number }
  try {
    verify = await verifyTransaction(reference)
  } catch (error) {
    console.error('[confirmInvitationAttempt] Paystack verify failed', { reference, message: error instanceof Error ? error.message : String(error) })
    return 'not_successful'
  }
  if (verify.status !== 'success') return 'not_successful'
  const { data, error } = await db.rpc('settle_invitation_paystack', {
    p_reference: reference, p_amount_kobo: verify.amountKobo,
  })
  if (error) {
    console.error('[confirmInvitationAttempt] settlement failed', { reference, message: error.message })
    return 'not_successful'
  }
  return (data as { status: ConfirmResult }).status
}

// Pure decision: given the current row status and Paystack's verify result,
// decide the outcome. No IO — unit tested directly. expectedKobo comes from
// the tournament's own registration_fee (per-tournament, admin-configurable),
// never a hardcoded platform-wide figure.
export function decideConfirmation(args: {
  existing: { payment_status: string } | null
  verify: { status: string; amountKobo: number } | null
  expectedKobo: number
}): ConfirmResult {
  if (!args.existing) return 'not_found'
  if (args.existing.payment_status === 'paid') return 'already_paid'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  // Reject underpayment (partial/tampered), but not overpayment — Paystack
  // adds its own transaction fee on top of the requested amount when the
  // account is configured for the customer to bear fees, so a successful
  // payment can legitimately verify at more than expectedKobo.
  if (args.verify.amountKobo < args.expectedKobo) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook.
export async function confirmRegistration(reference: string): Promise<ConfirmResult> {
  const db = createAdminClient()

  const { data: invitationAttempt } = await db.from('tournament_payment_attempts')
    .select('registration_id').eq('paystack_reference', reference).maybeSingle()
  if (invitationAttempt) {
    const result = await confirmInvitationAttempt(db, reference)
    if (result === 'confirmed') {
      const { data: reg } = await db.from('tournament_registrations')
        .select('id, player_id, fee_waived, tournament:tournaments(title, registration_fee)')
        .eq('id', invitationAttempt.registration_id).maybeSingle()
      if (reg) {
        const raw = reg.tournament as { title: string; registration_fee: number } | { title: string; registration_fee: number }[] | null
        const tournament = Array.isArray(raw) ? raw[0] : raw
        await settleReferralForPaidEntry(db, reg.player_id, {
          registrationFee: tournament?.registration_fee ?? 0, feeWaived: reg.fee_waived ?? false,
        })
        await notify({ type: 'registration_confirmed', playerId: reg.player_id,
          dedupeKey: regKey(reg.id), tournament: tournament?.title ?? 'the tournament' })
      }
    }
    return result
  }

  const { data: existing } = await db
    .from('tournament_registrations')
    .select('id, payment_status, player_id, fee_waived, coin_discount_naira, tournament:tournaments(title, registration_fee)')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (!existing) return 'not_found'
  if (existing.payment_status === 'paid') return 'already_paid'

  const tv = existing.tournament as
    | { title: string; registration_fee: number }
    | { title: string; registration_fee: number }[]
    | null
  const tournamentInfo = Array.isArray(tv) ? tv[0] : tv
  // A discounted registration's Paystack checkout was opened for
  // registration_fee - coin_discount_naira (see registerForTournament) — the
  // underpayment check below must expect that same reduced amount, or a
  // legitimately discounted half-price payment fails verification.
  const expectedKobo = ((tournamentInfo?.registration_fee ?? 0) - (existing.coin_discount_naira ?? 0)) * 100

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

  const decision = decideConfirmation({ existing, verify, expectedKobo })
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
  const { data: claimed } = await db
    .from('tournament_registrations')
    .update({ payment_status: 'paid' })
    .eq('id', existing.id)
    .eq('payment_status', 'pending')
    .select('id')

  // Referral credit rides on the same claim, so only the call that actually
  // flipped the row pays out — the callback and the webhook both land here for
  // the same reference by design.
  if (claimed && claimed.length > 0) {
    await settleReferralForPaidEntry(db, existing.player_id, {
      registrationFee: tournamentInfo?.registration_fee ?? 0,
      feeWaived: existing.fee_waived ?? false,
    })
    await finalizeSquadJoin(db, existing.id)
  }

  const tournamentTitle = tournamentInfo?.title ?? 'the tournament'
  await notify({
    type: 'registration_confirmed',
    playerId: existing.player_id,
    dedupeKey: regKey(existing.id),
    tournament: tournamentTitle,
  })

  return 'confirmed'
}
