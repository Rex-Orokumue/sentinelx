import { z } from 'zod'

const score = z.coerce
  .number()
  .int('Whole numbers only')
  .min(0, 'Cannot be negative')
  .max(99, 'Score is too large')

export const confirmScoreSchema = z.object({ scoreA: score, scoreB: score })
export type ConfirmScoreInput = z.infer<typeof confirmScoreSchema>
