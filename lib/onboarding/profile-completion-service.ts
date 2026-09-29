import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { onboardingProfileSchema } from './profile-schema'
import { parsePlayerPhone } from '@/lib/phone/number'
import { replaceGameInterests } from '@/lib/games/game-interest-service'

export type CompleteProfileOnboardingErrorCode = 'invalid_input' | 'invalid_whatsapp' | 'save_failed'
export type CompleteProfileOnboardingResult = { ok: true } | { ok: false; errorCode: CompleteProfileOnboardingErrorCode }

// Extracted from lib/onboarding/actions.ts's completeProfileOnboarding() so
// the validation + write logic has a test surface independent of FormData
// and Next's 'use server' plumbing.
export async function performCompleteProfileOnboarding(
  supabase: SupabaseClient<Database>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  rawInput: unknown,
): Promise<CompleteProfileOnboardingResult> {
  const parsed = onboardingProfileSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, errorCode: 'invalid_input' }

  const phone = parsePlayerPhone(parsed.data.whatsapp, { country: parsed.data.country })
  if (!phone) return { ok: false, errorCode: 'invalid_whatsapp' }

  // profiles is server-only-write (CLAUDE.md rule 9) — service role required.
  const { error } = await admin
    .from('profiles')
    .update({
      country: parsed.data.country,
      whatsapp_number: phone.e164,
      consent_whatsapp_updates: parsed.data.consentWhatsappUpdates === 'true',
      profile_completed_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) return { ok: false, errorCode: 'save_failed' }

  // game_interest already grants authenticated insert/delete on own rows —
  // session-scoped client keeps the admin client's blast radius to the
  // profiles write only.
  await replaceGameInterests(supabase, userId, parsed.data.gameInterests)

  return { ok: true }
}
