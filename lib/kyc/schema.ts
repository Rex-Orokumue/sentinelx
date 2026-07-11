import { z } from 'zod'

export const kycSchema = z.object({
  bankCode: z.string().trim().min(1, 'Select your bank'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
  bvn: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'BVN must be 11 digits'),
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name is too long'),
})

export type KycInput = z.infer<typeof kycSchema>
