import { z } from 'zod'

export const disqualifySchema = z.object({
  reason: z.string().trim().min(1, 'Enter a reason for the disqualification').max(300, 'Reason is too long'),
})
export type DisqualifyInput = z.infer<typeof disqualifySchema>

export const substituteSchema = z.object({
  username: z.string().trim().min(1, 'Enter a username'),
})
export type SubstituteInput = z.infer<typeof substituteSchema>
