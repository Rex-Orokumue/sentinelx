import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildRegistrationState } from '@/lib/tournaments/registration-state-service'

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
