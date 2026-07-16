import { z } from 'zod'

export const waiverGrantSchema = z.object({
  username: z.string().trim().min(1, 'Enter a username'),
  reason: z.union([z.literal(''), z.string().trim().max(200, 'Reason is too long')]),
})

export type WaiverGrantInput = z.infer<typeof waiverGrantSchema>
