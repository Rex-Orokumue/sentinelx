import { z } from 'zod'
import { usernameSchema } from '@/lib/auth/schema'
import { parsePlayerPhone } from '@/lib/phone/number'

export const profileEditSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
    username: z.union([z.literal(''), usernameSchema]),
    whatsapp: z.union([z.literal(''), z.string().trim().max(30)]),
    country: z.union([z.literal(''), z.string().trim().max(60, 'Country is too long')]),
    bio: z.union([z.literal(''), z.string().trim().max(280, 'Bio must be 280 characters or fewer')]),
    gameInterests: z.array(z.string().uuid()).optional(), // omitted = leave unchanged
    consentWhatsappUpdates: z.boolean().optional(), // omitted = leave unchanged
  })
  .superRefine((val, ctx) => {
    if (val.whatsapp && !parsePlayerPhone(val.whatsapp, { country: val.country })) {
      ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter a valid WhatsApp number for the selected country' })
    }
  })

export type ProfileEditInput = z.infer<typeof profileEditSchema>
