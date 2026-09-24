import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performCheckIn, type CheckInErrorCode } from '@/lib/matches/check-in-service'

const checkInResponse = z.object({ success: z.literal(true) })

const STATUS: Record<CheckInErrorCode, number> = {
  match_not_found: 404, not_participant: 403, not_match_day: 400, check_in_closed: 409, check_in_failed: 500,
}
const MESSAGE: Record<CheckInErrorCode, string> = {
  match_not_found: 'Match not found.',
  not_participant: "You're not playing in this match.",
  not_match_day: "You can check in once it's match day.",
  check_in_closed: 'This match is no longer open for check-in.',
  check_in_failed: 'Could not check you in. Please try again.',
}

export const checkInEndpoint = defineEndpoint({
  operationId: 'postMatchCheckIn',
  method: 'POST',
  path: '/matches/{id}/check-in',
  summary: 'Mark the signed-in player present for a match.',
  auth: 'user',
  response: checkInResponse,
  handler: async ({ ctx, params }) => {
    const result = await performCheckIn(ctx.userClient, ctx.admin, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
