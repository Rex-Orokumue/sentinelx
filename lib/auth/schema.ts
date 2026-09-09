import { z } from 'zod'

// These messages are CODES, not prose. The auth forms surface them through
// parsed.error.issues[0].message and translate them under the `auth.errors`
// namespace, so a Pidgin signup form cannot answer in English. Nothing renders
// them raw — useUsernameAvailability only reads .success.

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'username_too_short')
  .max(20, 'username_too_long')
  .regex(/^[a-zA-Z0-9_]+$/, 'username_charset')

export const passwordSchema = z.string().min(8, 'password_too_short')

export const loginSchema = z.object({
  email: z.string().trim().email('invalid_email'),
  password: z.string().min(1, 'password_required'),
})

export const signupSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email('invalid_email'),
  password: passwordSchema,
  ref: z.string().trim().optional(),
})

export const requestResetSchema = z.object({
  email: z.string().trim().email('invalid_email'),
})

export const resetPasswordSchema = z.object({
  password: passwordSchema,
})

// The password here is the CURRENT one, re-entered to prove the session really
// belongs to the account holder — so it is only checked for presence. Applying
// passwordSchema's 8-character minimum would reject anyone whose password
// predates that rule.
export const changeEmailSchema = z.object({
  email: z.string().trim().email('invalid_email'),
  password: z.string().min(1, 'password_required'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>
