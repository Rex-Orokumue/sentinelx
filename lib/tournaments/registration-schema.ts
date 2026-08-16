import { z } from 'zod'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY } from '@/lib/coins/value'

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

// The three radio positions on the entry-fee discount widget (spec §4). '0'
// means no discount applied — the default, pre-existing behavior.
export const coinsUsedSchema = z
  .union([z.literal('0'), z.literal(String(COINS_HALF_ENTRY)), z.literal(String(COINS_PER_ENTRY))])
  .default('0')
  .transform(Number)
