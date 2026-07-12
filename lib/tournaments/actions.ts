'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { checkCanRegister } from './guard'
import { registrationDetailsSchema } from './registration-schema'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type RegisterState = { error?: string } | undefined

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const parsed = registrationDetailsSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
    clubName: formData.get('clubName') ?? '',
    ignTag: formData.get('ignTag') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  // Re-fetch server-side; never trust the client for status, capacity, or rules.
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  // Only proves the checkbox was ticked at submit time — there is no way to
  // verify a player actually read the rules, and this deliberately doesn't try.
  if (tournament.rules && formData.get('agreedToRules') !== 'true') {
    return { error: 'Please confirm you have read and agree to the rules.' }
  }

  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')

  const { data: existing } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status, paystack_reference')
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)
    .maybeSingle()

  const guard = checkCanRegister({
    status: tournament.status,
    paidCount: paidCount ?? 0,
    maxPlayers: tournament.max_players,
    existingStatus: existing?.payment_status ?? null,
  })
  if (!guard.ok) {
    return {
      error:
        guard.reason === 'already_registered'
          ? "You're already registered for this tournament."
          : guard.reason === 'full'
            ? 'This tournament is full.'
            : 'Registration is closed for this tournament.',
    }
  }

  const regFields = {
    reg_display_name: parsed.data.displayName,
    reg_whatsapp: parsed.data.whatsapp,
    reg_club_name: parsed.data.clubName,
    reg_ign_tag: parsed.data.ignTag,
  }

  // Player has no self-UPDATE RLS policy on tournament_registrations (staff-only,
  // see migration 001) — writes go through the admin client, same pattern as
  // lib/kyc/actions.ts's submitKyc. The Server Action's own validation above
  // (auth, tournament state, input schema) is the trust boundary.
  const admin = createAdminClient()

  // Reuse the pending row's reference; otherwise create a fresh pending row.
  let reference = existing?.paystack_reference ?? null
  if (!existing) {
    reference = buildReference(tournamentId, user.id)
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
      ...regFields,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else {
    if (!reference) reference = buildReference(tournamentId, user.id)
    await admin
      .from('tournament_registrations')
      .update({ paystack_reference: reference, ...regFields })
      .eq('id', existing.id)
  }

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: REGISTRATION_FEE_NGN * 100,
      reference: reference!,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: user.id, slug: tournament.slug },
    })
  } catch {
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}
