import { z } from 'zod'

export const withdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(1000, 'Minimum withdrawal is ₦1,000')
    .max(100_000_000, 'Amount is too large'),
})

export type WithdrawalInput = z.infer<typeof withdrawalSchema>
