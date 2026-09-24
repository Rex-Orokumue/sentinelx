import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performSubmitLobbyResult, type SubmitLobbyResultErrorCode } from '@/lib/tournaments/submit-lobby-result-service'

const lobbyResultBody = z.object({
  placement: z.number().int().min(1).max(100),
  kills: z.number().int().min(0).max(100),
  screenshotPath: z.string(),
})
const lobbyResultResponse = z.object({ success: z.literal(true) })

const STATUS: Record<SubmitLobbyResultErrorCode, number> = {
  not_in_lobby: 403, lobby_confirmed: 409, validation_failed: 400, result_confirmed: 409, screenshot_required: 400, submit_failed: 500,
}
const MESSAGE: Record<SubmitLobbyResultErrorCode, string> = {
  not_in_lobby: 'You are not in this lobby.',
  lobby_confirmed: 'This lobby has been confirmed and can no longer be edited.',
  validation_failed: 'Please check your placement and kills.',
  result_confirmed: 'Your result is confirmed and can no longer be edited.',
  screenshot_required: 'A screenshot is required.',
  submit_failed: 'Could not submit your result. Please try again.',
}

export const lobbyResultEndpoint = defineEndpoint({
  operationId: 'postLobbyResult',
  method: 'POST',
  path: '/lobbies/{id}/result',
  summary: 'Submit a placement/kills result for one lobby (BR/points-race formats) for admin review.',
  auth: 'user',
  idempotent: true,
  body: lobbyResultBody,
  response: lobbyResultResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performSubmitLobbyResult(ctx.admin, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
