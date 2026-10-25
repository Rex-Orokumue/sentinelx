import type { createAdminClient } from '@/lib/supabase/admin'
import { cascadeNextInvitation } from './invitation-actions'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { SITE_URL } from '@/lib/seo/site'
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
import { notify } from '@/lib/notifications/notify'
import { regKey } from '@/lib/notifications/keys'

type Admin = ReturnType<typeof createAdminClient>

export type AcceptInvitationErrorCode = 'invitation_not_found' | 'invitation_no_longer_available' | 'invitation_expired' | 'registration_closed' | 'payment_init_failed'
export type AcceptInvitationResult =
  | { ok: false; errorCode: AcceptInvitationErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }

type PaymentState = {
  status: 'pending' | 'confirmed' | 'already_paid' | 'insufficient' | 'invitation_not_found' | 'invitation_no_longer_available' | 'invitation_expired' | 'registration_closed'
  tournamentId?: string
  tournamentSlug?: string
  fee?: number
  registrationId?: string
  tournamentTitle?: string
  newlyPaid?: boolean
}

// Extracted from lib/seasons/player-actions.ts's acceptMastersInvitation().
// email is required because initializeTransaction() needs it and it isn't
// derivable from tournament_invitations/tournament_registrations — it comes
// from auth.users, which the caller already has in scope (ctx.email in the
// endpoint, user.email in the Server Action wrapper).
export async function performAcceptInvitation(
  admin: Admin,
  userId: string,
  invitationId: string,
  email: string,
): Promise<AcceptInvitationResult> {
  // The RPC accepts the invitation and records every Paystack reference in
  // the same database transaction. It also handles an already accepted spot.
  const { data: prepared, error: prepareError } = await admin.rpc('accept_invitation_registration', {
    p_player: userId, p_invitation: invitationId,
  })
  if (prepareError) return { ok: false, errorCode: 'payment_init_failed' }
  const first = prepared as PaymentState
  if (first.status === 'confirmed') return { ok: true, status: 'confirmed', tournamentSlug: first.tournamentSlug! }
  if (first.status !== 'pending') return { ok: false, errorCode: mapPaymentError(first.status) }

  const reference = buildReference(first.tournamentId!, userId)
  const { data: attempt, error: attemptError } = await admin.rpc('start_invitation_payment_attempt', {
    p_player: userId, p_invitation: invitationId, p_reference: reference,
  })
  if (attemptError) return { ok: false, errorCode: 'payment_init_failed' }
  const payment = attempt as PaymentState
  if (payment.status === 'confirmed') return { ok: true, status: 'confirmed', tournamentSlug: payment.tournamentSlug! }
  if (payment.status !== 'pending') return { ok: false, errorCode: mapPaymentError(payment.status) }

  try {
    const authorizationUrl = await initializeTransaction({
      email,
      amountKobo: payment.fee! * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: payment.tournamentId, player_id: userId, slug: payment.tournamentSlug },
    })
    return { ok: true, status: 'pending', authorizationUrl, reference, tournamentSlug: payment.tournamentSlug! }
  } catch (err) {
    console.error('[performAcceptInvitation] Paystack initialize failed', { tournamentId: payment.tournamentId, reference, message: err instanceof Error ? err.message : String(err) })
    return { ok: false, errorCode: 'payment_init_failed' }
  }
}

function mapPaymentError(status: PaymentState['status']): AcceptInvitationErrorCode {
  if (status === 'invitation_not_found' || status === 'invitation_no_longer_available' || status === 'invitation_expired' || status === 'registration_closed') return status
  return 'payment_init_failed'
}

export type WalletInvitationResult =
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: false; errorCode: 'insufficient_wallet_balance' | AcceptInvitationErrorCode }

export async function performPayInvitationFromWallet(admin: Admin, userId: string, invitationId: string): Promise<WalletInvitationResult> {
  const { data, error } = await admin.rpc('pay_invitation_from_wallet', { p_player: userId, p_invitation: invitationId })
  if (error) {
    console.error('[performPayInvitationFromWallet] settlement failed', { invitationId, message: error.message })
    return { ok: false, errorCode: 'payment_init_failed' }
  }
  const result = data as PaymentState
  if (result.status === 'confirmed') {
    if (result.newlyPaid && result.registrationId) {
      await settleReferralForPaidEntry(admin, userId, { registrationFee: result.fee ?? 0, feeWaived: false })
      await notify({ type: 'registration_confirmed', playerId: userId,
        dedupeKey: regKey(result.registrationId), tournament: result.tournamentTitle ?? 'the tournament' })
    }
    return { ok: true, status: 'confirmed', tournamentSlug: result.tournamentSlug! }
  }
  if (result.status === 'insufficient') return { ok: false, errorCode: 'insufficient_wallet_balance' }
  return { ok: false, errorCode: mapPaymentError(result.status) }
}

export type DeclineInvitationErrorCode = 'invitation_not_found'
export type DeclineInvitationResult = { ok: false; errorCode: DeclineInvitationErrorCode } | { ok: true }

// Extracted from lib/seasons/player-actions.ts's declineMastersInvitation().
export async function performDeclineInvitation(admin: Admin, userId: string, invitationId: string): Promise<DeclineInvitationResult> {
  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('player_id', userId)
    .eq('status', 'pending')
    .select('id, tournament_id')
  if (!claimed || claimed.length === 0) return { ok: false, errorCode: 'invitation_not_found' }
  await cascadeNextInvitation(admin, claimed[0].tournament_id)
  return { ok: true }
}
