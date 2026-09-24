import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { buildMatchCentre } from '@/lib/matches/centre-service'

const matchCentreResponse = z.object({
  matchId: z.string(), status: z.string(), scheduledAt: z.string().nullable(), isFullDay: z.boolean(),
  isParticipant: z.boolean(), canCheckIn: z.boolean(), checkedInPlayerIds: z.array(z.string()),
  checkInVerdict: z.enum(['both', 'one', 'none']), soleAttendeeId: z.string().nullable(),
  wager: z.object({
    windowOpen: z.boolean(), pools: z.object({ playerA: z.number(), playerB: z.number() }),
    feeRate: z.number(), minStake: z.number(), maxStake: z.number(),
    myPickPlayerId: z.string().nullable(), myStakeCoins: z.number().nullable(),
    estimatedPayoutIfIStakeA100: z.number(),
  }),
  noShowEligible: z.boolean(),
})

export const matchCentreEndpoint = defineEndpoint({
  operationId: 'getMatchCentre',
  method: 'GET',
  path: '/matches/{id}/centre',
  summary: 'Composed Match Centre view: participation, check-in state, wager pools/window, no-show eligibility.',
  auth: 'public',
  response: matchCentreResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const view = await buildMatchCentre(supabase, params.id, ctx?.userId ?? null)
    if (!view) throw Errors.notFound()
    return view
  },
})
