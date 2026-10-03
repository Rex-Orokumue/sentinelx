import type { createAdminClient } from '@/lib/supabase/admin'
import type { OnboardingProfileCore } from './profile-schema'
import { knownCountryRegion, parsePlayerPhone } from '@/lib/phone/number'

export type CompleteProfileOnboardingErrorCode =
  | 'invalid_input'
  | 'invalid_country'
  | 'invalid_whatsapp'
  | 'unknown_game'
  | 'save_failed'
export type CompleteProfileOnboardingResult =
  | { ok: true }
  | { ok: false; errorCode: CompleteProfileOnboardingErrorCode }

// Postgres: foreign_key_violation (an unknown game id) and invalid_parameter_value
// (the function's own empty-interests guard).
const FK_VIOLATION = '23503'
const INVALID_PARAMETER = '22023'

// Semantic checks + the write, shared by the web Server Action and the mobile
// endpoint. Input is already shape-validated at each boundary (web: zod over
// FormData; mobile: the endpoint's body schema).
//
// The write is ONE database function, complete_profile_onboarding(): profile fields,
// the game-interest replacement and the profile_completed_at stamp commit or roll
// back together. The stamp is what the onboarding gate reads, so it must never be
// set unless the required game interests were saved too. profiles is server-only
// write (CLAUDE.md rule 9) — service role required.
export async function performCompleteProfileOnboarding(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  input: OnboardingProfileCore,
): Promise<CompleteProfileOnboardingResult> {
  // countryToRegion() falls back to Nigeria for anything it doesn't recognise, which
  // would let "Atlantis" through paired with a Nigerian number — reject it explicitly.
  if (!knownCountryRegion(input.country)) return { ok: false, errorCode: 'invalid_country' }

  const phone = parsePlayerPhone(input.whatsapp, { country: input.country })
  if (!phone) return { ok: false, errorCode: 'invalid_whatsapp' }

  const { error } = await admin.rpc('complete_profile_onboarding', {
    p_user_id: userId,
    p_country: input.country,
    p_whatsapp: phone.e164,
    p_consent: input.consentWhatsappUpdates,
    p_game_ids: input.gameInterests,
  })
  if (error) {
    if (error.code === FK_VIOLATION) return { ok: false, errorCode: 'unknown_game' }
    if (error.code === INVALID_PARAMETER) return { ok: false, errorCode: 'invalid_input' }
    return { ok: false, errorCode: 'save_failed' }
  }
  return { ok: true }
}
