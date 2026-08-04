'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { cascadeNextInvitation } from './invitation-actions'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type InvitationResponseState = { error?: string; success?: boolean } | undefined

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

  const admin = createAdminClient()
  const { data: invitation } = await admin
    .from('tournament_invitations')
    .select('id, player_id, status, expires_at, tournament_id, tournament:tournaments(id, slug, title, registration_fee)')
    .eq('id', invitationId)
    .maybeSingle()
  if (!invitation || invitation.player_id !== user.id) return { error: 'Invitation not found.' }
  if (invitation.status !== 'pending') return { error: 'This invitation is no longer available.' }
  if (new Date(invitation.expires_at) < new Date()) return { error: 'This invitation has expired.' }

  const t = Array.isArray(invitation.tournament) ? invitation.tournament[0] : invitation.tournament
  if (!t) return { error: 'Tournament not found.' }

  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select('id')
  if (!claimed || claimed.length === 0) return { error: 'This invitation is no longer available.' }

  const isFree = t.registration_fee <= 0
  const reference = isFree ? null : buildReference(t.id, user.id)

  await admin.from('tournament_registrations').insert({
    tournament_id: t.id,
    player_id: user.id,
    status: 'active',
    payment_status: isFree ? 'paid' : 'pending',
    paystack_reference: reference,
  })

  revalidatePath('/dashboard')
  if (isFree) redirect(`/tournaments/${t.slug}?paid=1`)

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: t.registration_fee * 100,
      reference: reference!,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: t.id, player_id: user.id, slug: t.slug },
    })
  } catch (err) {
    console.error('[acceptMastersInvitation] Paystack initialize failed', {
      tournamentId: t.id,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Your spot is reserved — try again from your dashboard.' }
  }
  redirect(authorizationUrl)
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

  const admin = createAdminClient()
  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('player_id', user.id)
    .eq('status', 'pending')
    .select('id, tournament_id')
  if (!claimed || claimed.length === 0) return { error: 'This invitation is no longer available.' }

  await cascadeNextInvitation(admin, claimed[0].tournament_id)
  revalidatePath('/dashboard')
  return { success: true }
}
