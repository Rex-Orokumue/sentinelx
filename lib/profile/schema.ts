import { z } from 'zod'

export const profileEditSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  whatsapp: z.union([
    z.literal(''),
    z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
  ]),
  country: z.union([z.literal(''), z.string().trim().max(60, 'Country is too long')]),
  bio: z.union([z.literal(''), z.string().trim().max(280, 'Bio must be 280 characters or fewer')]),
})

export type ProfileEditInput = z.infer<typeof profileEditSchema>
