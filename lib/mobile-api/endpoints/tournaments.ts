import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildRegistrationState } from '@/lib/tournaments/registration-state-service'
import { performRegisterForTournament, type RegisterErrorCode } from '@/lib/tournaments/register-service'

const registrationStateResponse = z.object({
  view: z.enum(['guest', 'can_register', 'complete_payment', 'registered', 'waitlisted', 'full', 'closed', 'ended', 'invitation_only']),
  feeNaira: z.number(),
  hasWaiver: z.boolean(),
  coinDiscountEligible: z.boolean(),
  agreementRequired: z.boolean(),
})

export const registrationStateEndpoint = defineEndpoint({
  operationId: 'getTournamentRegistrationState',
  method: 'GET',
  path: '/tournaments/{id}/registration-state',
  summary: 'Registration view-state, fee, waiver and coin-discount eligibility for one tournament, for the caller (or a logged-out guest).',
  auth: 'public',
  response: registrationStateResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const admin = ctx?.admin ?? createAdminClient()
    const state = await buildRegistrationState(supabase, admin, params.id, ctx?.userId ?? null)
    if (!state) throw Errors.notFound()
    return state
  },
})

const registerBody = z.object({
  displayName: z.string().trim().min(1).max(60),
  whatsapp: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  clubName: z.string().trim().min(1).max(60),
  ignTag: z.string().trim().max(60).optional(),
  agreedToRules: z.boolean(),
  coinsUsed: z.number().int().nonnegative().default(0),
  squadId: z.string().optional(),
})

const registerResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmed') }),
  z.object({ status: z.literal('pending'), authorizationUrl: z.string(), reference: z.string() }),
])

const REGISTER_ERROR_STATUS: Record<RegisterErrorCode, number> = {
  needs_username: 400, tournament_not_found: 404, rules_agreement_required: 400,
  already_registered: 409, tournament_full: 409, invitation_only: 403, registration_closed: 409,
  squads_not_available: 400, squad_not_found: 404, squad_not_accepting_members: 409, squad_full: 409,
  insufficient_coins: 400, registration_failed: 500, payment_init_failed: 502,
}
const REGISTER_ERROR_MESSAGE: Record<RegisterErrorCode, string> = {
  needs_username: 'Claim a username before registering.',
  tournament_not_found: 'Tournament not found.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_registered: "You're already registered for this tournament.",
  tournament_full: 'This tournament is full.',
  invitation_only: 'This tournament is invitation-only. Check your dashboard for an invite.',
  registration_closed: 'Registration is closed for this tournament.',
  squads_not_available: 'Squad registration is not available in the app yet.',
  squad_not_found: 'That squad no longer exists for this tournament.',
  squad_not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
  insufficient_coins: 'Not enough SX Coins for this discount.',
  registration_failed: 'Could not complete registration. Please try again.',
  payment_init_failed: 'Payment could not be started. Please try again.',
}

export const registerEndpoint = defineEndpoint({
  operationId: 'postTournamentRegister',
  method: 'POST',
  path: '/tournaments/{id}/register',
  summary: 'Register for a tournament — waiver, zero-fee, coin-discount-to-zero, or Paystack, in that precedence.',
  auth: 'user',
  idempotent: true,
  body: registerBody,
  response: registerResponse,
  handler: async ({ ctx, body, params }) => {
    if (body.squadId) throw new ApiError(400, 'squads_not_available', REGISTER_ERROR_MESSAGE.squads_not_available)
    const result = await performRegisterForTournament(ctx.userClient, ctx.admin, ctx.userId, params.id, {
      displayName: body.displayName, whatsapp: body.whatsapp, clubName: body.clubName,
      ignTag: body.ignTag ?? null, agreedToRules: body.agreedToRules, coinsUsed: body.coinsUsed,
      squadId: null,
    })
    if (!result.ok) throw new ApiError(REGISTER_ERROR_STATUS[result.errorCode], result.errorCode, REGISTER_ERROR_MESSAGE[result.errorCode])
    if (result.status === 'confirmed') return { status: 'confirmed' as const }
    return { status: 'pending' as const, authorizationUrl: result.authorizationUrl, reference: result.reference }
  },
})
