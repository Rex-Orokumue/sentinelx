import { z } from 'zod'

export const gameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  category: z.enum(['football', 'fighting', 'shooter', 'other']),
  iconUrl: z.union([z.literal(''), z.string().trim().url('Enter a valid URL')]),
})

export type GameInput = z.infer<typeof gameSchema>
