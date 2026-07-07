import { z } from 'zod'

export const withdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of naira')
    .min(1000, 'Minimum withdrawal is ₦1,000')
    .max(100_000_000, 'Amount is too large'),
  bankName: z.string().trim().min(1, 'Bank name is required').max(100, 'Bank name is too long'),
  accountName: z
    .string()
    .trim()
    .min(1, 'Account name is required')
    .max(100, 'Account name is too long'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
})

export type WithdrawalInput = z.infer<typeof withdrawalSchema>
