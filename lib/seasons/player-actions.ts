'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performAcceptInvitation, performDeclineInvitation, performPayInvitationFromWallet, type AcceptInvitationErrorCode } from './invitation-response-service'

export type InvitationResponseState = { error?: string; success?: boolean } | undefined

const ACCEPT_ERROR_MESSAGES: Record<AcceptInvitationErrorCode, string> = {
  invitation_not_found: 'Invitation not found.',
  invitation_no_longer_available: 'This invitation is no longer available.',
  invitation_expired: 'This invitation has expired.',
  registration_closed: 'Registration is closed for this tournament.',
  payment_init_failed: 'Payment could not be started. Your spot is reserved — try again from your dashboard.',
}

// Accepts the invitation and completes wallet settlement or starts a tracked
// Paystack attempt. An accepted but unpaid player can invoke this again.
export async function acceptMastersInvitation(
  _prev: InvitationResponseState,
  formData: FormData,
): Promise<InvitationResponseState> {
  const invitationId = String(formData.get('invitationId') ?? '')
  if (!invitationId) return { error: 'Missing invitation.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const method = String(formData.get('paymentMethod') ?? 'paystack')
  if (method !== 'wallet' && method !== 'paystack') return { error: 'Choose a payment method.' }
  const result = method === 'wallet'
    ? await performPayInvitationFromWallet(createAdminClient(), user.id, invitationId)
    : await performAcceptInvitation(createAdminClient(), user.id, invitationId, user.email!)
  if (!result.ok) {
    if (result.errorCode === 'insufficient_wallet_balance') return { error: 'Your wallet balance does not cover the entry fee.' }
    return { error: ACCEPT_ERROR_MESSAGES[result.errorCode] }
  }

  revalidatePath('/dashboard')
  if (result.status === 'confirmed') redirect(`/tournaments/${result.tournamentSlug}?paid=1`)
  if ('authorizationUrl' in result) redirect(result.authorizationUrl)
  return { error: 'Payment could not be started.' }
}

export async function declineMastersInvitation(
  _prev: InvitationResponseState,
  formData: FormData,
): Promise<InvitationResponseState> {
  const invitationId = String(formData.get('invitationId') ?? '')
  if (!invitationId) return { error: 'Missing invitation.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performDeclineInvitation(createAdminClient(), user.id, invitationId)
  if (!result.ok) return { error: 'This invitation is no longer available.' }

  revalidatePath('/dashboard')
  return { success: true }
}
