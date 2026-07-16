import { z } from 'zod'

export const registrationDetailsSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  whatsapp: z
    .string()
    .trim()
    .min(1, 'WhatsApp number is required')
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
  clubName: z.string().trim().min(1, 'Club name is required').max(60, 'Club name is too long'),
  ignTag: z.union([z.literal(''), z.string().trim().max(60, 'In-game player ID / tag is too long')]),
})

export type RegistrationDetailsInput = z.infer<typeof registrationDetailsSchema>
