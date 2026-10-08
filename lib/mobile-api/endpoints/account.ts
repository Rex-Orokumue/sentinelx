import { z } from 'zod'
import type { User } from '@supabase/supabase-js'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'
import { ApiError } from '../errors'
import { bearerPort } from '@/lib/auth/account-auth-port'
import { performChangeEmail } from '@/lib/auth/email-change-service'
import { performUnlinkGoogle } from '@/lib/auth/unlink-google-service'
import { verifyPassword, hasPasswordIdentity } from '@/lib/auth/reauth'
import { isIdentifierBanned } from '@/lib/auth/signup-blocks'
import { changeEmailSchema } from '@/lib/auth/schema'
import { performRequestDeletion, performCancelDeletion, performDeleteNow } from '@/lib/settings/deletion-flow'
import { daysRemaining, deletionDueAt, isPendingDeletion } from '@/lib/settings/grace'
import { performRequestPhoneCode, performConfirmPhoneCode } from '@/lib/phone/service'
import { performSetLocale } from '@/lib/profile/locale-service'
import { hitLimit, reauthKey, REAUTH_LIMIT } from '@/lib/rate-limit/account-limiter'
import { LOCALES } from '@/i18n/locales'

// ---- error descriptors -------------------------------------------------------------------

interface ErrorDescriptor {
  status: number
  code: string
  message: string
  fields?: Record<string, string>
  details?: Record<string, unknown>
}
const isDescriptor = (v: unknown): v is ErrorDescriptor =>
  typeof v === 'object' && v !== null && 'status' in v && 'code' in v && 'message' in v

const err = (status: number, code: string, message: string, extra: Pick<ErrorDescriptor, 'fields' | 'details'> = {}): ErrorDescriptor => ({
  status,
  code,
  message,
  ...extra,
})
const retry = (seconds: number) => ({ fields: { retryAfterSeconds: String(seconds) } })

// Handlers return a value or an ErrorDescriptor; the endpoint wrapper throws the latter as an
// ApiError so the standard envelope and status handling in defineEndpoint apply.
export async function runWithCtx<T>(fn: () => Promise<T | ErrorDescriptor>): Promise<T> {
  const result = await fn()
  if (isDescriptor(result)) throw new ApiError(result.status, result.code, result.message, result.fields, result.details)
  return result as T
}

// ---- GET /me/account ---------------------------------------------------------------------

// Last three digits only. A short number is masked entirely so the mask never reveals it.
export function maskPhone(phone: string): string {
  if (phone.length <= 3) return '•'.repeat(phone.length)
  return '•'.repeat(phone.length - 3) + phone.slice(-3)
}

const accountResponse = z.object({
  deletion: z.object({ requestedAt: z.string(), dueAt: z.string(), daysRemaining: z.number().int() }).nullable(),
  signIn: z.object({
    email: z.string().nullable(),
    pendingEmail: z.string().nullable(),
    // A hint, not truth: a Google user who set a password through the reset flow has no
    // 'email' identity (hasPasswordIdentity). The app words `false` as "set or reset a password".
    passwordIdentity: z.boolean(),
    google: z.boolean(),
  }),
  phone: z.object({ masked: z.string(), verifiedAt: z.string() }).nullable(),
  locale: z.string().nullable(),
})

interface AccountProfileRow {
  deletion_requested_at: string | null
  deleted_at: string | null
  phone: string | null
  phone_verified_at: string | null
  locale: string | null
}

export function toAccountResponse(
  profile: AccountProfileRow,
  user: Pick<User, 'email' | 'new_email' | 'identities'>,
  now: Date,
): z.infer<typeof accountResponse> {
  const pending = isPendingDeletion(profile)
  const requested = pending && profile.deletion_requested_at ? new Date(profile.deletion_requested_at) : null
  return {
    deletion: requested
      ? { requestedAt: requested.toISOString(), dueAt: deletionDueAt(requested).toISOString(), daysRemaining: daysRemaining(requested, now) }
      : null,
    signIn: {
      email: user.email ?? null,
      pendingEmail: user.new_email ?? null,
      passwordIdentity: hasPasswordIdentity({ identities: user.identities }),
      google: (user.identities ?? []).some((i) => i.provider === 'google'),
    },
    phone: profile.phone && profile.phone_verified_at ? { masked: maskPhone(profile.phone), verifiedAt: profile.phone_verified_at } : null,
    locale: profile.locale,
  }
}

// ---- handler logic (returns value | ErrorDescriptor) -------------------------------------

type Admin = MobileCtx['admin']
const okTrue = { ok: true as const }

async function reauthGate(admin: Admin, userId: string): Promise<ErrorDescriptor | null> {
  const gate = await hitLimit(admin, { key: reauthKey(userId), ...REAUTH_LIMIT })
  return gate.allowed ? null : err(429, 'reauth_rate_limited', 'Too many attempts. Try again later.', retry(gate.retryAfterSeconds))
}

export const handlers = {
  async getAccount(ctx: MobileCtx) {
    const [{ data: profile }, { data: auth }] = await Promise.all([
      ctx.admin
        .from('profiles')
        .select('deletion_requested_at, deleted_at, phone, phone_verified_at, locale')
        .eq('id', ctx.userId)
        .maybeSingle(),
      ctx.admin.auth.admin.getUserById(ctx.userId),
    ])
    if (!profile || !auth?.user) return err(404, 'not_found', 'Not found.')
    return toAccountResponse(profile, auth.user, new Date())
  },

  async requestDeletion(ctx: MobileCtx, body: { confirm: 'DELETE' }) {
    if (body.confirm !== 'DELETE') return err(400, 'confirm_required', 'Type DELETE to confirm.')
    const result = await performRequestDeletion(ctx.admin, { id: ctx.userId, email: ctx.email })
    if (!result.ok) {
      return result.reason === 'blocked'
        ? err(409, 'deletion_blocked', 'This account cannot be deleted yet.', { details: { blockers: result.blockers } })
        : err(500, 'deletion_save_failed', 'Could not schedule deletion.')
    }
    return { requestedAt: result.requestedAt.toISOString(), dueAt: result.dueAt.toISOString() }
  },

  async cancelDeletion(ctx: MobileCtx) {
    const result = await performCancelDeletion(ctx.admin, { id: ctx.userId, email: ctx.email })
    return result.ok ? okTrue : err(500, 'deletion_cancel_failed', 'Could not cancel the deletion.')
  },

  async deleteNow(ctx: MobileCtx, body: { username: string }) {
    const result = await performDeleteNow(ctx.admin, ctx.userId, body.username)
    if (result.ok) return okTrue
    return result.reason === 'blocked'
      ? err(409, 'deletion_blocked', 'This account cannot be deleted yet.', { details: { blockers: result.blockers } })
      : err(400, 'username_mismatch', 'That does not match your username.')
  },

  async requestPhoneCode(ctx: MobileCtx, body: { phone: string }) {
    const result = await performRequestPhoneCode({ admin: ctx.admin, userId: ctx.userId, rawPhone: body.phone, strictDelivery: true })
    if (result.ok) return { expiresAt: result.expiresAt, resendAt: result.resendAt }
    switch (result.reason) {
      case 'unavailable':
        return err(503, 'phone_unavailable', 'Phone verification is unavailable right now.')
      case 'invalid_phone':
        return err(400, 'phone_invalid', 'Enter a valid phone number.')
      case 'send_failed':
        return err(502, 'phone_send_failed', 'Could not send the code.')
      case 'save_failed':
        return err(500, 'phone_save_failed', 'Could not send the code.')
      case 'cooldown':
        return err(429, 'phone_cooldown', 'Wait before requesting another code.', retry(result.retryAfterSeconds))
      case 'daily_limit':
        return err(429, 'phone_daily_limit', 'Too many codes requested today.', retry(result.retryAfterSeconds))
    }
  },

  async confirmPhoneCode(ctx: MobileCtx, body: { code: string }) {
    const result = await performConfirmPhoneCode({ admin: ctx.admin, userId: ctx.userId, code: body.code })
    if (result.ok) return { verifiedAt: result.verifiedAt }
    switch (result.reason) {
      case 'invalid_code':
        return err(400, 'phone_code_invalid', 'Enter the 6-digit code.')
      case 'missing':
        return err(409, 'phone_code_missing', 'Request a new code first.')
      case 'expired':
        return err(409, 'phone_code_expired', 'That code expired.')
      case 'attempts_exceeded':
        return err(429, 'phone_attempts_exceeded', 'Too many incorrect attempts.')
      case 'wrong':
        return err(400, 'phone_code_wrong', 'Incorrect code.')
    }
  },

  async changeEmail(ctx: MobileCtx, body: { email: string; password: string }) {
    const gated = await reauthGate(ctx.admin, ctx.userId)
    if (gated) return gated
    const { data: auth } = await ctx.admin.auth.admin.getUserById(ctx.userId)
    const result = await performChangeEmail({
      port: bearerPort({ accessToken: ctx.accessToken, userId: ctx.userId, admin: ctx.admin }),
      user: { email: auth?.user?.email ?? ctx.email, identities: auth?.user?.identities },
      input: body,
      deps: { verifyPassword, isBanned: (value) => isIdentifierBanned(ctx.admin, value) },
    })
    if (result.ok) return { sentTo: result.sentTo }
    const status = result.errorCode === 'email_in_use' ? 409 : result.errorCode === 'failed' ? 502 : 400
    return err(status, result.errorCode, 'Could not change the email.')
  },

  async unlinkGoogle(ctx: MobileCtx, body: { password: string }) {
    const gated = await reauthGate(ctx.admin, ctx.userId)
    if (gated) return gated
    const result = await performUnlinkGoogle({
      port: bearerPort({ accessToken: ctx.accessToken, userId: ctx.userId, admin: ctx.admin }),
      user: { email: ctx.email },
      password: body.password,
      verifyPassword,
    })
    if (result.ok) return okTrue
    switch (result.errorCode) {
      case 'not_linked':
      case 'last_identity':
        return err(409, result.errorCode, 'Google cannot be unlinked.')
      case 'unavailable':
        return err(503, 'linking_unavailable', 'Unlinking is unavailable right now.')
      case 'failed':
        return err(502, 'failed', 'Could not unlink Google.')
      default:
        return err(400, result.errorCode, 'Could not unlink Google.')
    }
  },

  async setLocale(ctx: MobileCtx, body: { locale: (typeof LOCALES)[number] }) {
    const result = await performSetLocale(ctx.admin, ctx.userId, body.locale)
    return result.ok ? { locale: result.locale } : err(500, 'locale_save_failed', 'Could not save your language.')
  },
}

// ---- endpoints ---------------------------------------------------------------------------

const ok = z.object({ ok: z.literal(true) })

export const getMyAccountEndpoint = defineEndpoint({
  operationId: 'getMyAccount',
  method: 'GET',
  path: '/me/account',
  summary: 'Deletion state, sign-in methods, masked phone and locale for the Settings hub.',
  auth: 'user',
  response: accountResponse,
  handler: ({ ctx }) => runWithCtx(() => handlers.getAccount(ctx)),
})

export const requestAccountDeletionEndpoint = defineEndpoint({
  operationId: 'postAccountDeletion',
  method: 'POST',
  path: '/me/deletion',
  summary: 'Start the 15-day account-deletion grace period. 409 deletion_blocked lists every blocker in error.details.blockers.',
  auth: 'user',
  body: z.object({ confirm: z.literal('DELETE') }),
  response: z.object({ requestedAt: z.string(), dueAt: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.requestDeletion(ctx, body)),
})

export const cancelAccountDeletionEndpoint = defineEndpoint({
  operationId: 'deleteAccountDeletion',
  method: 'DELETE',
  path: '/me/deletion',
  summary: 'Cancel a pending account deletion.',
  auth: 'user',
  response: ok,
  handler: ({ ctx }) => runWithCtx(() => handlers.cancelDeletion(ctx)),
})

export const deleteAccountNowEndpoint = defineEndpoint({
  operationId: 'postAccountDeletionExecute',
  method: 'POST',
  path: '/me/deletion/execute',
  summary: 'Delete the account immediately; the body must carry the exact username. Irreversible.',
  auth: 'user',
  body: z.object({ username: z.string().min(1).max(64) }),
  response: ok,
  handler: ({ ctx, body }) => runWithCtx(() => handlers.deleteNow(ctx, body)),
})

export const requestPhoneCodeEndpoint = defineEndpoint({
  operationId: 'postPhoneCode',
  method: 'POST',
  path: '/me/phone/code',
  summary: 'Send a 6-digit WhatsApp verification code. 503 phone_unavailable when WhatsApp is not configured.',
  auth: 'user',
  body: z.object({ phone: z.string().trim().min(5).max(32) }),
  response: z.object({ expiresAt: z.string(), resendAt: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.requestPhoneCode(ctx, body)),
})

export const confirmPhoneCodeEndpoint = defineEndpoint({
  operationId: 'postPhoneConfirm',
  method: 'POST',
  path: '/me/phone/confirm',
  summary: 'Confirm the WhatsApp code and mark the phone verified.',
  auth: 'user',
  body: z.object({ code: z.string().trim().min(1).max(12) }),
  response: z.object({ verifiedAt: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.confirmPhoneCode(ctx, body)),
})

export const changeMyEmailEndpoint = defineEndpoint({
  operationId: 'postMyEmail',
  method: 'POST',
  path: '/me/email',
  summary: 'Start an email change. Needs the current password; nothing changes until the link in the new inbox is opened.',
  auth: 'user',
  body: changeEmailSchema,
  response: z.object({ sentTo: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.changeEmail(ctx, body)),
})

export const unlinkGoogleEndpoint = defineEndpoint({
  operationId: 'deleteGoogleIdentity',
  method: 'DELETE',
  path: '/me/identities/google',
  summary: 'Unlink Google sign-in. Needs the current password; signs out every other session.',
  auth: 'user',
  body: z.object({ password: z.string().min(1).max(256) }),
  response: ok,
  handler: ({ ctx, body }) => runWithCtx(() => handlers.unlinkGoogle(ctx, body)),
})

export const setMyLocaleEndpoint = defineEndpoint({
  operationId: 'putMyLocale',
  method: 'PUT',
  path: '/me/locale',
  summary: "Save the signed-in player's language (en, fr or pcm).",
  auth: 'user',
  body: z.object({ locale: z.enum(LOCALES) }),
  response: z.object({ locale: z.enum(LOCALES) }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.setLocale(ctx, body)),
})
