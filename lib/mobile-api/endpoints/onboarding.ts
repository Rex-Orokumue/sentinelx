import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import type { MobileCtx } from '../auth'
import { performClaimUsername, type ClaimUsernameErrorCode } from '@/lib/onboarding/claim-username-service'
import { onboardingProfileCoreSchema, type OnboardingProfileCore } from '@/lib/onboarding/profile-schema'
import { performCompleteProfileOnboarding } from '@/lib/onboarding/profile-completion-service'

const USERNAME_ERROR_MESSAGES: Record<ClaimUsernameErrorCode, string> = {
  username_too_short: 'Username must be at least 3 characters.',
  username_too_long: 'Username must be 20 characters or fewer.',
  username_charset: 'Usernames can only contain letters, numbers and underscores.',
  username_taken: 'That username is taken.',
  username_save_failed: 'Could not save that username. Please try again.',
}

const usernameBody = z.object({ username: z.string() })
const usernameResponse = z.object({ username: z.string() })

export const claimUsernameEndpoint = defineEndpoint({
  operationId: 'postOnboardingUsername',
  method: 'POST',
  path: '/onboarding/username',
  summary: 'Claim a username after email confirmation — resolveOnboardingGate’s first step.',
  auth: 'user',
  body: usernameBody,
  response: usernameResponse,
  handler: async ({ ctx, body }) => {
    const result = await performClaimUsername(ctx.userClient, ctx.admin, ctx.userId, body.username)
    if (!result.ok) throw new ApiError(400, result.errorCode, USERNAME_ERROR_MESSAGES[result.errorCode])
    return { username: result.username }
  },
})

// Field-level errors use the standard envelope: 400 validation_failed with { fields: { <name>: <message> } }.
export async function completeProfileForUser(
  admin: MobileCtx['admin'],
  userId: string,
  body: OnboardingProfileCore,
): Promise<{ profileCompletedAt: string }> {
  const result = await performCompleteProfileOnboarding(admin, userId, body)
  if (!result.ok) {
    switch (result.errorCode) {
      case 'invalid_country':
        throw Errors.validation({ country: 'Select a valid country.' })
      case 'invalid_whatsapp':
        throw Errors.validation({ whatsapp: 'Enter a valid WhatsApp number for the selected country.' })
      case 'unknown_game':
        throw Errors.validation({ gameInterests: 'One of the selected games does not exist.' })
      case 'invalid_input':
        throw Errors.validation({ gameInterests: 'Select at least one game.' })
      default:
        throw new ApiError(500, 'save_failed', 'Could not save your profile. Please try again.')
    }
  }
  // Read the server-owned stamp back so the app updates its gate from the source of truth.
  const { data } = await admin.from('profiles').select('profile_completed_at').eq('id', userId).maybeSingle()
  return { profileCompletedAt: data?.profile_completed_at ?? new Date().toISOString() }
}

const completeProfileResponse = z.object({ profileCompletedAt: z.string() })

// Not marked idempotent: replaying the same payload is safe by construction (the database
// function replaces rather than appends and keeps the original completion timestamp), so
// the client does not need an Idempotency-Key — same as postOnboardingUsername.
export const completeProfileEndpoint = defineEndpoint({
  operationId: 'postOnboardingProfile',
  method: 'POST',
  path: '/onboarding/profile',
  summary:
    'Complete the compulsory profile step — country, WhatsApp number (normalised to E.164 for the chosen country), WhatsApp-updates consent and at least one game interest. Atomic: stamps profileCompletedAt only if every field was saved.',
  auth: 'user',
  body: onboardingProfileCoreSchema,
  response: completeProfileResponse,
  handler: async ({ ctx, body }) => completeProfileForUser(ctx.admin, ctx.userId, body),
})
