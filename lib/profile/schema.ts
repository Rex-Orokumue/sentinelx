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
    // omitted = leave unchanged. When sent it must name at least one game: a player who has
    // completed onboarding is never allowed to drop below one interest.
    gameInterests: z.array(z.string().uuid()).min(1, 'Select at least one game').optional(),
    consentWhatsappUpdates: z.boolean().optional(), // omitted = leave unchanged
  })
  .superRefine((val, ctx) => {
    if (val.whatsapp && !parsePlayerPhone(val.whatsapp, { country: val.country })) {
      ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter a valid WhatsApp number for the selected country' })
    }
  })

export type ProfileEditInput = z.infer<typeof profileEditSchema>
