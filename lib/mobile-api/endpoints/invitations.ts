import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performAcceptInvitation, performDeclineInvitation, type AcceptInvitationErrorCode, type DeclineInvitationErrorCode } from '@/lib/seasons/invitation-response-service'

const acceptResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmed') }),
  z.object({ status: z.literal('pending'), authorizationUrl: z.string(), reference: z.string() }),
])

const ACCEPT_ERROR_STATUS: Record<AcceptInvitationErrorCode, number> = {
  invitation_not_found: 404, invitation_no_longer_available: 409, invitation_expired: 410, payment_init_failed: 502,
}
const ACCEPT_ERROR_MESSAGE: Record<AcceptInvitationErrorCode, string> = {
  invitation_not_found: 'Invitation not found.',
  invitation_no_longer_available: 'This invitation is no longer available.',
  invitation_expired: 'This invitation has expired.',
  payment_init_failed: 'Payment could not be started. Your spot is reserved — try again from your dashboard.',
}

export const acceptInvitationEndpoint = defineEndpoint({
  operationId: 'postInvitationAccept',
  method: 'POST',
  path: '/invitations/{id}/accept',
  summary: 'Accept a season invitation — confirms immediately if free, else opens a Paystack transaction.',
  auth: 'user',
  idempotent: true,
  response: acceptResponse,
  handler: async ({ ctx, params }) => {
    const result = await performAcceptInvitation(ctx.admin, ctx.userId, params.id, ctx.email ?? '')
    if (!result.ok) throw new ApiError(ACCEPT_ERROR_STATUS[result.errorCode], result.errorCode, ACCEPT_ERROR_MESSAGE[result.errorCode])
    if (result.status === 'confirmed') return { status: 'confirmed' as const }
    return { status: 'pending' as const, authorizationUrl: result.authorizationUrl, reference: result.reference }
  },
})

const declineResponse = z.object({ status: z.literal('declined') })
const DECLINE_ERROR_STATUS: Record<DeclineInvitationErrorCode, number> = { invitation_not_found: 404 }

export const declineInvitationEndpoint = defineEndpoint({
  operationId: 'postInvitationDecline',
  method: 'POST',
  path: '/invitations/{id}/decline',
  summary: 'Decline a season invitation — cascades to the next invitee.',
  auth: 'user',
  response: declineResponse,
  handler: async ({ ctx, params }) => {
    const result = await performDeclineInvitation(ctx.admin, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(DECLINE_ERROR_STATUS[result.errorCode], result.errorCode, 'Invitation not found.')
    return { status: 'declined' as const }
  },
})
