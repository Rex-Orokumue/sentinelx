import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { submitOpponentRating, type RatingErrorCode } from '@/lib/scoring/opponent-rating-service'

const ratingBody = z.object({ stars: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]) })
const ratingResponse = z.object({ success: z.literal(true) })

const STATUS: Record<RatingErrorCode, number> = {
  match_not_found: 404, not_a_participant: 403, result_not_confirmed_yet: 409,
  cannot_rate_self: 400, not_ratable: 400, already_rated: 409,
}
const MESSAGE: Record<RatingErrorCode, string> = {
  match_not_found: 'Match not found.',
  not_a_participant: 'Only the players in this match can rate each other.',
  result_not_confirmed_yet: 'You can rate your opponent once the result is confirmed.',
  cannot_rate_self: 'You cannot rate yourself.',
  not_ratable: 'This match cannot be rated.',
  already_rated: "You've already rated this match.",
}

export const ratingEndpoint = defineEndpoint({
  operationId: 'postMatchRating',
  method: 'POST',
  path: '/matches/{id}/rating',
  summary: 'Rate your opponent 1-5 stars after a confirmed match result.',
  auth: 'user',
  idempotent: true,
  body: ratingBody,
  response: ratingResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await submitOpponentRating(ctx.admin, { matchId: params.id, raterId: ctx.userId, stars: body.stars })
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
