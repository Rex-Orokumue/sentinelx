import { z } from 'zod'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY } from '@/lib/coins/value'

// displayName + whatsapp are the only fields every registration needs
// regardless of game — everything else comes from the per-game catalogue
// (see lib/tournaments/registration-fields.ts's buildRegistrationSchema).
export const fixedRegistrationSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(60, 'Display name is too long'),
  whatsapp: z
    .string()
    .trim()
    .min(1, 'WhatsApp number is required')
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid WhatsApp number'),
})

export type FixedRegistrationInput = z.infer<typeof fixedRegistrationSchema>

// The three radio positions on the entry-fee discount widget (spec §4). '0'
// means no discount applied — the default, pre-existing behavior.
export const coinsUsedSchema = z
  .union([z.literal('0'), z.literal(String(COINS_HALF_ENTRY)), z.literal(String(COINS_PER_ENTRY))])
  .default('0')
  .transform(Number)
