import { z } from 'zod'
import { MIN_WAGER_STAKE, MAX_WAGER_STAKE } from '@/lib/wagers/market'

export const MIN_NAIRA_STAKE = 100

export const challengeSchema = z
  .object({
    opponentId: z.string().uuid(),
    stakeAmount: z.union([z.literal(''), z.coerce.number().int().positive()]),
    stakeCurrency: z.union([z.literal(''), z.enum(['naira', 'coins'])]),
    gameCode: z.union([z.literal(''), z.string().trim().max(100)]),
  })
  .refine((d) => d.stakeAmount === '' || d.stakeCurrency !== '', {
    message: 'Choose a stake currency.',
    path: ['stakeCurrency'],
  })
  .refine((d) => d.stakeAmount === '' || d.stakeCurrency === 'coins' || d.stakeAmount >= MIN_NAIRA_STAKE, {
    message: `Minimum ₦ stake is ₦${MIN_NAIRA_STAKE}`,
    path: ['stakeAmount'],
  })
  .refine(
    (d) => d.stakeAmount === '' || d.stakeCurrency === 'naira' || (d.stakeAmount >= MIN_WAGER_STAKE && d.stakeAmount <= MAX_WAGER_STAKE),
    { message: `Coin stake must be between ${MIN_WAGER_STAKE} and ${MAX_WAGER_STAKE}`, path: ['stakeAmount'] },
  )

export type ChallengeInput = z.infer<typeof challengeSchema>
