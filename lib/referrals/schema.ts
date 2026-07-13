import { z } from 'zod'

export const referralWithdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(500, 'Minimum withdrawal is ₦500'),
})

export type ReferralWithdrawalInput = z.infer<typeof referralWithdrawalSchema>
