'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performAcceptInvitation, performDeclineInvitation, type AcceptInvitationErrorCode } from './invitation-response-service'

export type InvitationResponseState = { error?: string; success?: boolean } | undefined

const ACCEPT_ERROR_MESSAGES: Record<AcceptInvitationErrorCode, string> = {
  invitation_not_found: 'Invitation not found.',
  invitation_no_longer_available: 'This invitation is no longer available.',
  invitation_expired: 'This invitation has expired.',
  payment_init_failed: 'Payment could not be started. Your spot is reserved — try again from your dashboard.',
}

// Creates a normal tournament_registrations row and, if there's a fee,
// redirects to Paystack exactly like registerForTournament — the existing
// confirmRegistration/webhook pipeline (lib/tournaments/confirm.ts) already
// looks rows up purely by paystack_reference, so no new webhook branch is
// needed for payment to be confirmed.
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

  const result = await performAcceptInvitation(createAdminClient(), user.id, invitationId, user.email!)
  if (!result.ok) return { error: ACCEPT_ERROR_MESSAGES[result.errorCode] }

  revalidatePath('/dashboard')
  if (result.status === 'confirmed') redirect(`/tournaments/${result.tournamentSlug}?paid=1`)
  redirect(result.authorizationUrl)
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
