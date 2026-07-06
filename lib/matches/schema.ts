import { z } from 'zod'

const scoreSchema = z.coerce
  .number()
  .int('Scores must be whole numbers')
  .min(0, 'Score cannot be negative')
  .max(99, 'Score is too large')

const recordingUrlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .refine((v) => /^https?:\/\//i.test(v), 'Link must start with http:// or https://')

export const submitResultSchema = z.object({
  scoreA: scoreSchema,
  scoreB: scoreSchema,
  recordingUrl: z.union([recordingUrlSchema, z.literal('')]).optional(),
})

export type SubmitResultInput = z.infer<typeof submitResultSchema>
