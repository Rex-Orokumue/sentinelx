import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores')

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters')

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

export const signupSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email'),
  password: passwordSchema,
})

export const requestResetSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
})

export const resetPasswordSchema = z.object({
  password: passwordSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
