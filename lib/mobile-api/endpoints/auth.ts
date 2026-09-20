import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { createAnonClient } from '../anon-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { performSignup, type SignupServiceErrorCode } from '@/lib/auth/signup-service'
import { usernameSchema, passwordSchema } from '@/lib/auth/schema'
import { LOCALES } from '@/i18n/locales'

const SIGNUP_ERROR_MESSAGES: Record<SignupServiceErrorCode, string> = {
  blocked_details: 'That email or username can’t be used.',
  username_taken: 'That username is taken.',
  username_taken_go_back: 'That username was just taken — go back and pick another.',
  signup_failed: 'Signup failed. Please try again.',
}

const signupBody = z.object({
  username: usernameSchema,
  email: z.string().trim().email('invalid_email'),
  password: passwordSchema,
  ref: z.string().trim().optional(),
  locale: z.enum(LOCALES).optional(),
})
const ok = z.object({ ok: z.literal(true) })

export const signupEndpoint = defineEndpoint({
  operationId: 'postAuthSignup',
  method: 'POST',
  path: '/auth/signup',
  summary: 'Create an account (ban/retired-username checks, referral + locale metadata). A confirmation email follows via the existing Supabase template.',
  auth: 'public',
  body: signupBody,
  response: ok,
  handler: async ({ body }) => {
    const result = await performSignup(createAnonClient(), createAdminClient(), body)
    if (!result.ok) throw new ApiError(422, result.errorCode, SIGNUP_ERROR_MESSAGES[result.errorCode])
    return { ok: true as const }
  },
})

const emailBody = z.object({ email: z.string().trim().email('invalid_email') })

export const resendConfirmationEndpoint = defineEndpoint({
  operationId: 'postAuthResendConfirmation',
  method: 'POST',
  path: '/auth/resend-confirmation',
  summary: 'Re-send the signup confirmation email. Always returns ok — neutral regardless of whether the address maps to an unconfirmed account.',
  auth: 'public',
  body: emailBody,
  response: ok,
  handler: async ({ body }) => {
    const { error } = await createAnonClient().auth.resend({ type: 'signup', email: body.email.trim().toLowerCase() })
    if (error && (error as { code?: string }).code !== 'over_email_send_rate_limit') {
      console.error('[resendConfirmationEndpoint] resend failed', { code: (error as { code?: string }).code, message: error.message })
    }
    return { ok: true as const }
  },
})

export const requestResetEndpoint = defineEndpoint({
  operationId: 'postAuthRequestReset',
  method: 'POST',
  path: '/auth/request-reset',
  summary: 'Send a password-reset email. Always returns ok — neutral regardless of whether the account exists.',
  auth: 'public',
  body: emailBody,
  response: ok,
  handler: async ({ body }) => {
    await createAnonClient().auth.resetPasswordForEmail(body.email.trim())
    return { ok: true as const }
  },
})
