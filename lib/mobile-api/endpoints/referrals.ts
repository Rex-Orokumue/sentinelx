import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { getReferralOverview } from '@/lib/referrals/overview'

const invited = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  tier: z.string(),
  frameUrl: z.string().nullable(),
  status: z.enum(['pending', 'converted', 'invalid']),
  date: z.string(),
  coinsAwarded: z.number().int().nullable(),
})

export const getMyReferralsEndpoint = defineEndpoint({
  operationId: 'getMyReferrals',
  method: 'GET',
  path: '/me/referrals',
  summary: "The signed-in player's referral link, conversions, coin awards, milestone progress and invited players.",
  auth: 'user',
  response: z.object({
    username: z.string().nullable(),
    shareUrl: z.string().nullable(),
    totalReferrals: z.number().int(),
    convertedCount: z.number().int(),
    totalCoinsEarned: z.number().int(),
    nextMilestone: z.object({ count: z.number().int(), bonusCoins: z.number().int().nullable() }).nullable(),
    invited: z.array(invited),
    milestoneHistory: z.array(z.object({ id: z.string(), description: z.string(), coins: z.number().int(), date: z.string() })),
  }),
  handler: async ({ ctx }) => {
    const result = await getReferralOverview(ctx.admin, ctx.userId)
    if (!result.ok) {
      if (result.reason === 'not_found') throw new ApiError(404, 'not_found', 'Not found.')
      throw new ApiError(500, 'referrals_load_failed', 'Could not load referrals.')
    }
    return result.value
  },
})
