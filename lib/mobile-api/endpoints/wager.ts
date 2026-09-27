import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performPlaceWager, type PlaceWagerErrorCode } from '@/lib/wagers/place-wager-service'
import { MIN_WAGER_STAKE, MAX_WAGER_STAKE } from '@/lib/wagers/market'

const wagerBody = z.object({
  pickPlayerId: z.string().uuid(),
  stakeCoins: z.number().int().min(MIN_WAGER_STAKE).max(MAX_WAGER_STAKE),
})
const wagerResponse = z.object({ success: z.literal(true) })

const STATUS: Record<PlaceWagerErrorCode, number> = {
  pending_deletion: 403, match_not_found: 404, own_match: 400, invalid_pick: 400,
  window_closed: 409, insufficient_coins: 400, wager_failed: 500,
}
const MESSAGE: Record<PlaceWagerErrorCode, string> = {
  pending_deletion: 'Your account is pending deletion.',
  match_not_found: 'Match not found.',
  own_match: 'You cannot wager on your own match.',
  invalid_pick: 'Pick must be one of the two players in this match.',
  window_closed: 'Wagering is closed for this match.',
  insufficient_coins: 'Not enough SX Coins for this stake.',
  wager_failed: 'Could not place your wager. Please try again.',
}

export const wagerEndpoint = defineEndpoint({
  operationId: 'postMatchWager',
  method: 'POST',
  path: '/matches/{id}/wager',
  summary: 'Place or change a coin wager on a match you are not playing in.',
  auth: 'user',
  idempotent: true,
  body: wagerBody,
  response: wagerResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performPlaceWager(ctx.userClient, ctx.admin, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
