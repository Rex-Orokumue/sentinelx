import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performClaimUsername, type ClaimUsernameErrorCode } from '@/lib/onboarding/claim-username-service'

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
