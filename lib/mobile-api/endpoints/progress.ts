import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { getMyProgress } from '@/lib/players/progress-service'

const tier = z.string()

const progressResponse = z
  .object({
    xp: z.number(),
    membershipTier: tier,
    tierProgress: z
      .object({ current: tier, next: tier, xpIntoTier: z.number(), xpForNextTier: z.number() })
      .strict()
      .nullable(),
    sxScore: z.number(),
    sentinelTier: z.string().nullable(),
    coinBalance: z.number(),
    seasonStanding: z
      .object({
        seasonName: z.string().nullable(),
        rank: z.number().nullable(),
        points: z.number(),
        pointsAtRankSixteen: z.number(),
        monthlyRank: z.number().nullable(),
        monthlyPoints: z.number(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const myProgressEndpoint = defineEndpoint({
  operationId: 'getMyProgress',
  method: 'GET',
  path: '/me/progress',
  summary:
    'Owner-only progress: XP and membership tier (with progress to the next tier, null at max), SX Score, coin balance, and the active DLS season standing (null with no active season).',
  auth: 'user',
  cacheControl: 'no-store',
  response: progressResponse,
  handler: async ({ ctx }) => {
    const progress = await getMyProgress(ctx.userClient, () => ctx.admin, ctx.userId)
    if (!progress) throw Errors.notFound()
    return progress
  },
})
