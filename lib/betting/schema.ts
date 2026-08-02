import { z } from 'zod'

export const placeBetSchema = z.object({
  matchId: z.string().uuid('Invalid match.'),
  side: z.enum(['player_a', 'player_b'], { message: 'Pick a side.' }),
  stakeAmount: z.coerce
    .number()
    .int('Stake must be a whole number of naira')
    .min(100, 'Minimum stake is ₦100')
    .max(50_000, 'Maximum stake is ₦50,000'),
})

export type PlaceBetInput = z.infer<typeof placeBetSchema>
