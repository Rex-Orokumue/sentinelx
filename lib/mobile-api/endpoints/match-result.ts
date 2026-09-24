import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performSubmitMatchResult, type SubmitResultErrorCode } from '@/lib/matches/submit-result-service'

const matchResultBody = z.object({
  scoreA: z.number().int().min(0).max(99),
  scoreB: z.number().int().min(0).max(99),
  recordingUrl: z.string().optional().default(''),
  screenshotPath: z.string(),
})
const matchResultResponse = z.object({ success: z.literal(true) })

const STATUS: Record<SubmitResultErrorCode, number> = {
  match_not_found: 404, bye_no_result: 400, not_participant: 403, match_cancelled: 409,
  already_confirmed: 409, submission_locked: 409, screenshot_required: 400, validation_failed: 400, submit_failed: 500,
}
const MESSAGE: Record<SubmitResultErrorCode, string> = {
  match_not_found: 'Match not found.',
  bye_no_result: 'This is a bye — there is no result to submit.',
  not_participant: 'Only the players in this match can submit a result.',
  match_cancelled: 'This match was cancelled.',
  already_confirmed: 'This match result is already confirmed.',
  submission_locked: 'Your submission is under review and can no longer be edited.',
  screenshot_required: 'A screenshot is required.',
  validation_failed: 'Please check your score entries.',
  submit_failed: 'Could not submit your result. Please try again.',
}

export const matchResultEndpoint = defineEndpoint({
  operationId: 'postMatchResult',
  method: 'POST',
  path: '/matches/{id}/result',
  summary: 'Submit a match result (screenshot required) for admin review.',
  auth: 'user',
  idempotent: true,
  body: matchResultBody,
  response: matchResultResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performSubmitMatchResult(ctx.userClient, ctx.admin, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
