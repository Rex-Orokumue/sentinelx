'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { REGISTRATION_FEE_NGN } from '@/lib/paystack'
import { checkCanRegister } from './guard'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type RegisterState = { error?: string } | undefined

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  // Re-fetch server-side; never trust the client for status or capacity.
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

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

  // Reuse the pending row's reference; otherwise create a fresh pending row.
  let reference = existing?.paystack_reference ?? null
  if (!existing) {
    reference = buildReference(tournamentId, user.id)
    const { error: insertErr } = await supabase.from('tournament_registrations').insert({
      tournament_id: tournamentId,
      player_id: user.id,
      payment_status: 'pending',
      paystack_reference: reference,
    })
    if (insertErr) return { error: 'Could not start registration. Please try again.' }
  } else if (!reference) {
    reference = buildReference(tournamentId, user.id)
    await supabase
      .from('tournament_registrations')
      .update({ paystack_reference: reference })
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
