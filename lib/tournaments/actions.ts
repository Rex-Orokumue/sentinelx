'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fixedRegistrationSchema, coinsUsedSchema } from './registration-schema'
import { buildRegistrationSchema, fetchRegistrationFields } from './registration-fields'
import { performRegisterForTournament, type RegisterErrorCode } from './register-service'

export type RegisterState = { error?: string; needsUsername?: boolean } | undefined

const ERROR_MESSAGES: Record<RegisterErrorCode, string> = {
  needs_username: 'Claim a username before registering.',
  tournament_not_found: 'Tournament not found.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_registered: "You're already registered for this tournament.",
  tournament_full: 'This tournament is full.',
  invitation_only: 'This tournament is invitation-only. Check your dashboard for an invite.',
  registration_closed: 'Registration is closed for this tournament.',
  squads_not_available: 'This tournament does not use squads.',
  squad_not_found: 'That squad no longer exists for this tournament.',
  squad_not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
  insufficient_coins: 'Not enough SX Coins for this discount.',
  registration_failed: 'Could not complete registration. Please try again.',
  payment_init_failed: 'Payment could not be started. Please try again.',
}

export async function registerForTournament(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const tournamentId = String(formData.get('tournamentId') ?? '')
  if (!tournamentId) return { error: 'Missing tournament.' }

  const supabase = createClient()

  const { data: tournament } = await supabase.from('tournaments').select('game_id').eq('id', tournamentId).maybeSingle()
  if (!tournament) return { error: 'Tournament not found.' }

  const fixedParsed = fixedRegistrationSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    whatsapp: formData.get('whatsapp') ?? '',
  })
  if (!fixedParsed.success) return { error: fixedParsed.error.issues[0].message }

  const fields = await fetchRegistrationFields(supabase, tournament.game_id)
  const dynamicParsed = buildRegistrationSchema(fields).safeParse(
    Object.fromEntries(fields.map((f) => [f.fieldKey, formData.get(f.fieldKey) ?? ''])),
  )
  if (!dynamicParsed.success) return { error: dynamicParsed.error.issues[0].message }

  const coinsUsedParsed = coinsUsedSchema.safeParse(formData.get('coinsUsed') ?? '0')
  const coinsUsed = coinsUsedParsed.success ? coinsUsedParsed.data : 0

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to register.' }

  const squadIdRaw = String(formData.get('squadId') ?? '')

  const result = await performRegisterForTournament(supabase, createAdminClient(), user.id, tournamentId, {
    displayName: fixedParsed.data.displayName,
    whatsapp: fixedParsed.data.whatsapp,
    registrationDetails: dynamicParsed.data,
    agreedToRules: formData.get('agreedToRules') === 'true',
    coinsUsed,
    squadId: squadIdRaw || null,
  })

  if (!result.ok) {
    return result.errorCode === 'needs_username'
      ? { error: ERROR_MESSAGES.needs_username, needsUsername: true }
      : { error: ERROR_MESSAGES[result.errorCode] }
  }

  if (result.status === 'confirmed') redirect(`/tournaments/${result.tournamentSlug}?paid=1`)
  redirect(result.authorizationUrl)
}
