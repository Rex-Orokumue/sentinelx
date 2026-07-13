import { z } from 'zod'

export const friendlyWithdrawalSchema = z.object({
  amount: z.coerce.number().int().min(100, 'Minimum withdrawal is ₦100'),
})

export type FriendlyWithdrawalInput = z.infer<typeof friendlyWithdrawalSchema>
