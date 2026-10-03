'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from './safe-path'
import { createAdminClient } from '@/lib/supabase/admin'
import { performClaimUsername } from './claim-username-service'
import { onboardingProfileSchema, parseOnboardingProfileFormData, toOnboardingCore } from './profile-schema'
import { performCompleteProfileOnboarding, type CompleteProfileOnboardingErrorCode } from './profile-completion-service'

// Codes, translated by the onboarding form under `auth.errors` — same
// convention as lib/auth/actions.ts.
export type ClaimUsernameErrorCode =
  | 'username_too_short'
  | 'username_too_long'
  | 'username_charset'
  | 'username_taken'
  | 'username_save_failed'

export type ClaimUsernameState = { errorCode?: ClaimUsernameErrorCode } | undefined

export async function claimUsername(
  _prev: ClaimUsernameState,
  formData: FormData,
): Promise<ClaimUsernameState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const result = await performClaimUsername(supabase, createAdminClient(), user.id, String(formData.get('username') ?? ''))
  if (!result.ok) return { errorCode: result.errorCode }

  redirect(safeInternalPath(formData.get('next') as string | null, '/dashboard'))
}

export type CompleteProfileOnboardingState = { errorCode?: CompleteProfileOnboardingErrorCode } | undefined

export async function completeProfileOnboarding(
  _prev: CompleteProfileOnboardingState,
  formData: FormData,
): Promise<CompleteProfileOnboardingState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/profile')

  const parsed = onboardingProfileSchema.safeParse(parseOnboardingProfileFormData(formData))
  if (!parsed.success) return { errorCode: 'invalid_input' }

  const result = await performCompleteProfileOnboarding(createAdminClient(), user.id, toOnboardingCore(parsed.data))
  if (!result.ok) return { errorCode: result.errorCode }

  redirect(safeInternalPath(formData.get('next') as string | null, '/dashboard'))
}
