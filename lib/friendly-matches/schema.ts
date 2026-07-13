import { z } from 'zod'

export const challengeSchema = z.object({
  opponentId: z.string().uuid(),
  stakeAmount: z.union([
    z.literal(''),
    z.coerce.number().int().min(100, 'Minimum stake is ₦100'),
  ]),
})

export type ChallengeInput = z.infer<typeof challengeSchema>
