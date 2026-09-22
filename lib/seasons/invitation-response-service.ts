import type { createAdminClient } from '@/lib/supabase/admin'
import { cascadeNextInvitation } from './invitation-actions'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { SITE_URL } from '@/lib/seo/site'

type Admin = ReturnType<typeof createAdminClient>

export type AcceptInvitationErrorCode = 'invitation_not_found' | 'invitation_no_longer_available' | 'invitation_expired' | 'payment_init_failed'
export type AcceptInvitationResult =
  | { ok: false; errorCode: AcceptInvitationErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }

interface TournamentInfo { id: string; slug: string; title: string; registration_fee: number }

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
  const { data: invitation } = await admin
    .from('tournament_invitations')
    .select('id, player_id, status, expires_at, tournament_id, tournament:tournaments(id, slug, title, registration_fee)')
    .eq('id', invitationId)
    .maybeSingle()
  if (!invitation || invitation.player_id !== userId) return { ok: false, errorCode: 'invitation_not_found' }
  if (invitation.status !== 'pending') return { ok: false, errorCode: 'invitation_no_longer_available' }
  if (new Date(invitation.expires_at as string) < new Date()) return { ok: false, errorCode: 'invitation_expired' }

  const tRaw = invitation.tournament as TournamentInfo | TournamentInfo[] | null
  const t = Array.isArray(tRaw) ? tRaw[0] : tRaw
  if (!t) return { ok: false, errorCode: 'invitation_not_found' }

  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select('id')
  if (!claimed || claimed.length === 0) return { ok: false, errorCode: 'invitation_no_longer_available' }

  const isFree = t.registration_fee <= 0
  const reference = isFree ? null : buildReference(t.id, userId)

  await admin.from('tournament_registrations').insert({
    tournament_id: t.id, player_id: userId, status: 'active',
    payment_status: isFree ? 'paid' : 'pending', paystack_reference: reference,
  })

  if (isFree) return { ok: true, status: 'confirmed', tournamentSlug: t.slug }

  try {
    const authorizationUrl = await initializeTransaction({
      email,
      amountKobo: t.registration_fee * 100,
      reference: reference!,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: t.id, player_id: userId, slug: t.slug },
    })
    return { ok: true, status: 'pending', authorizationUrl, reference: reference!, tournamentSlug: t.slug }
  } catch (err) {
    console.error('[performAcceptInvitation] Paystack initialize failed', { tournamentId: t.id, reference, message: err instanceof Error ? err.message : String(err) })
    return { ok: false, errorCode: 'payment_init_failed' }
  }
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
