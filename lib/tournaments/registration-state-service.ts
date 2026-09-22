import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveRegistrationView, type RegView } from './view'

type Admin = ReturnType<typeof createAdminClient>

export interface RegistrationState {
  view: RegView
  feeNaira: number
  hasWaiver: boolean
  coinDiscountEligible: boolean
  agreementRequired: boolean
}

// New composition (spec S5.2) — not extracted from one existing function.
// The view-state machine IS extracted, from resolveRegistrationView(); the
// waiver lookup and coin-discount eligibility are genuinely new, composed
// alongside it here.
export async function buildRegistrationState(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  tournamentId: string,
  userId: string | null,
): Promise<RegistrationState | null> {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, registration_fee, max_players, invitation_only, rules')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return null

  let paidCount = 0
  let existingStatus: string | null = null
  let registrationStatus: string | null = null
  let hasWaiver = false

  if (userId) {
    const { count } = await supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('payment_status', 'paid')
    paidCount = count ?? 0

    const { data: existing } = await supabase
      .from('tournament_registrations')
      .select('id, payment_status, status')
      .eq('tournament_id', tournamentId)
      .eq('player_id', userId)
      .maybeSingle()
    existingStatus = existing?.payment_status ?? null
    registrationStatus = existing?.status ?? null

    const { data: waiver } = await admin
      .from('tournament_fee_waivers')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('player_id', userId)
      .is('redeemed_at', null)
      .maybeSingle()
    hasWaiver = !!waiver
  }

  const view = resolveRegistrationView({
    status: tournament.status,
    loggedIn: userId !== null,
    paidCount,
    maxPlayers: tournament.max_players,
    existingStatus,
    registrationStatus,
    invitationOnly: tournament.invitation_only,
  })

  return {
    view,
    feeNaira: tournament.registration_fee,
    hasWaiver,
    coinDiscountEligible: userId !== null && tournament.registration_fee >= 500 && !hasWaiver,
    agreementRequired: !!tournament.rules,
  }
}
