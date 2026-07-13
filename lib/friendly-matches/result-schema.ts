import { z } from 'zod'

export const friendlyResultSchema = z.object({
  scoreChallenger: z.coerce.number().int().min(0),
  scoreOpponent: z.coerce.number().int().min(0),
})

export type FriendlyResultInput = z.infer<typeof friendlyResultSchema>
