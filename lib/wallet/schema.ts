import { z } from 'zod'

export const walletWithdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(100, 'Minimum withdrawal is ₦100')
    .max(100_000_000, 'Amount is too large'),
})

export type WalletWithdrawalInput = z.infer<typeof walletWithdrawalSchema>
