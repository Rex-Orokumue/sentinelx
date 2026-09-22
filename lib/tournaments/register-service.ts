import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { checkCanRegister } from './guard'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { NAIRA_PER_COIN } from '@/lib/coins/value'
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
import { finalizeSquadJoin } from './squad-membership'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { SITE_URL } from '@/lib/seo/site'

type Admin = ReturnType<typeof createAdminClient>

export type RegisterErrorCode =
  | 'needs_username' | 'tournament_not_found' | 'rules_agreement_required'
  | 'already_registered' | 'tournament_full' | 'invitation_only' | 'registration_closed'
  | 'squads_not_available' | 'squad_not_found' | 'squad_not_accepting_members' | 'squad_full'
  | 'insufficient_coins' | 'registration_failed' | 'payment_init_failed'

export type RegisterInput = {
  displayName: string
  whatsapp: string
  clubName: string
  ignTag: string | null
  agreedToRules: boolean
  coinsUsed: number
  squadId: string | null
}

export type RegisterResult =
  | { ok: false; errorCode: RegisterErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }

// Extracted from lib/tournaments/actions.ts's registerForTournament() — the
// Server Action and POST /tournaments/{id}/register both call this. The
// Server Action still owns turning a 'confirmed'/'pending' result into its
// own redirect() — this function never redirects, it only returns.
export async function performRegisterForTournament(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  tournamentId: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  const restricted = await assertNotPendingDeletion(admin, userId)
  if (restricted) return { ok: false, errorCode: 'registration_failed' }

  const { data: callerProfile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!callerProfile?.username) return { ok: false, errorCode: 'needs_username' }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules, registration_fee, invitation_only, entry_unit, squad_size')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { ok: false, errorCode: 'tournament_not_found' }

  if (tournament.rules && !input.agreedToRules) return { ok: false, errorCode: 'rules_agreement_required' }

  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')

  const { data: existing } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status')
    .eq('tournament_id', tournamentId)
    .eq('player_id', userId)
    .maybeSingle()

  const guard = checkCanRegister({
    status: tournament.status,
    paidCount: paidCount ?? 0,
    maxPlayers: tournament.max_players,
    existingStatus: existing?.payment_status ?? null,
    invitationOnly: tournament.invitation_only,
  })
  if (!guard.ok) {
    const map: Record<typeof guard.reason, RegisterErrorCode> = {
      already_registered: 'already_registered', full: 'tournament_full',
      invitation_only: 'invitation_only', not_open: 'registration_closed',
    }
    return { ok: false, errorCode: map[guard.reason] }
  }

  const squadId = input.squadId && tournament.entry_unit === 'squad' ? input.squadId : null
  if (input.squadId && !squadId) return { ok: false, errorCode: 'squads_not_available' }
  if (squadId) {
    const { data: squad } = await supabase.from('squads').select('id, tournament_id, status').eq('id', squadId).maybeSingle()
    if (!squad || squad.tournament_id !== tournamentId) return { ok: false, errorCode: 'squad_not_found' }
    if (squad.status !== 'forming') return { ok: false, errorCode: 'squad_not_accepting_members' }
    const { count: squadMemberCount } = await supabase.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', squadId)
    if ((squadMemberCount ?? 0) >= (tournament.squad_size ?? 0)) return { ok: false, errorCode: 'squad_full' }
  }

  const regFields = {
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp,
    reg_club_name: input.clubName, reg_ign_tag: input.ignTag || null,
  }

  const { data: waiver } = await admin
    .from('tournament_fee_waivers')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', userId)
    .is('redeemed_at', null)
    .maybeSingle()

  if (waiver) {
    const { data: redeemed } = await admin
      .from('tournament_fee_waivers')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('id', waiver.id)
      .is('redeemed_at', null)
      .select('id')
    if (!redeemed || redeemed.length === 0) return { ok: false, errorCode: 'registration_failed' }

    const freeRegRow = { tournament_id: tournamentId, player_id: userId, payment_status: 'paid', fee_waived: true, paystack_reference: null, joining_squad_id: squadId, ...regFields }
    let waiverRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { ok: false, errorCode: 'registration_failed' }
      waiverRegId = inserted.id
    } else {
      await admin.from('tournament_registrations').update({ payment_status: 'paid', fee_waived: true, paystack_reference: null, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
    }
    if (squadId && waiverRegId) await finalizeSquadJoin(admin, waiverRegId)
    return { ok: true, status: 'confirmed', tournamentSlug: tournament.slug }
  }

  if (tournament.registration_fee === 0) {
    const freeRegRow = { tournament_id: tournamentId, player_id: userId, payment_status: 'paid', fee_waived: false, paystack_reference: null, joining_squad_id: squadId, ...regFields }
    let zeroFeeRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { ok: false, errorCode: 'registration_failed' }
      zeroFeeRegId = inserted.id
    } else {
      await admin.from('tournament_registrations').update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
    }
    if (squadId && zeroFeeRegId) await finalizeSquadJoin(admin, zeroFeeRegId)
    return { ok: true, status: 'confirmed', tournamentSlug: tournament.slug }
  }

  let coinDiscountNaira = 0
  if (input.coinsUsed > 0 && tournament.registration_fee >= 500) {
    const balance = await getCoinBalance(admin, userId)
    if (balance < input.coinsUsed) return { ok: false, errorCode: 'insufficient_coins' }
    coinDiscountNaira = Math.round(input.coinsUsed * NAIRA_PER_COIN)
    await recordCoinTransaction(admin, userId, -input.coinsUsed, 'entry_discount', tournamentId, `Tournament entry discount — ${tournament.slug}`)
  }
  const netFee = tournament.registration_fee - coinDiscountNaira

  if (netFee <= 0) {
    const freeRegRow = { tournament_id: tournamentId, player_id: userId, payment_status: 'paid', fee_waived: false, paystack_reference: null, coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields }
    let coinFreeRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { ok: false, errorCode: 'registration_failed' }
      coinFreeRegId = inserted.id
    } else {
      await admin.from('tournament_registrations').update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
    }
    await settleReferralForPaidEntry(admin, userId, { registrationFee: tournament.registration_fee, feeWaived: false })
    if (squadId && coinFreeRegId) await finalizeSquadJoin(admin, coinFreeRegId)
    return { ok: true, status: 'confirmed', tournamentSlug: tournament.slug }
  }

  const reference = buildReference(tournamentId, userId)
  if (!existing) {
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId, player_id: userId, payment_status: 'pending', paystack_reference: reference,
      coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields,
    })
    if (insertErr) return { ok: false, errorCode: 'registration_failed' }
  } else {
    await admin.from('tournament_registrations').update({ paystack_reference: reference, coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
  }

  // Need the caller's email for Paystack — read it from auth via the RLS
  // client's own session (same source registerForTournament used: user.email!).
  // This calls auth.getUser() a second time rather than threading the whole
  // User object through the function, keeping the parameter list to userId
  // (matches every other already-extracted service in this codebase).
  const { data: authData } = await supabase.auth.getUser()
  try {
    const authorizationUrl = await initializeTransaction({
      email: authData.user!.email!,
      amountKobo: netFee * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: userId, slug: tournament.slug },
    })
    return { ok: true, status: 'pending', authorizationUrl, reference, tournamentSlug: tournament.slug }
  } catch (err) {
    console.error('[performRegisterForTournament] Paystack initialize failed', {
      tournamentId, reference, message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, errorCode: 'payment_init_failed' }
  }
}
