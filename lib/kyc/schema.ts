import { z } from 'zod'

// BVN identification is disabled for now — most players are minors who
// don't have a BVN, and Paystack's identification API doesn't support NIN
// as an alternative. Verification is payout-account-only until a
// guardian/NIN-based path is designed (see submitKyc in ./actions).
export const kycSchema = z.object({
  bankCode: z.string().trim().min(1, 'Select your bank'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name is too long'),
})

export type KycInput = z.infer<typeof kycSchema>
