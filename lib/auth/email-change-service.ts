import type { User } from '@supabase/supabase-js'
import { hasPasswordIdentity } from './reauth'
import type { AccountAuthPort } from './account-auth-port'

export type ChangeEmailErrorCode =
  | 'invalid_email'
  | 'password_required'
  | 'not_logged_in'
  | 'same_email'
  | 'wrong_password'
  | 'google_only'
  | 'email_banned'
  | 'email_in_use'
  | 'failed'

export type ChangeEmailOutcome = { ok: true; sentTo: string } | { ok: false; errorCode: ChangeEmailErrorCode }

export interface ChangeEmailDeps {
  verifyPassword: (email: string, password: string) => Promise<boolean>
  isBanned: (email: string) => Promise<boolean>
}

// Extracted from lib/auth/actions.ts changeEmail(); the action and POST /me/email both call it.
// The order is load-bearing and unchanged: same-address check, password (before concluding
// there isn't one), ban blocklist, then the provider. See the comments on changeEmail's
// history: a Google user who set a password through the reset flow has no 'email' identity,
// so the identity list is only consulted AFTER the password has failed.
export async function performChangeEmail(args: {
  port: AccountAuthPort
  user: { email?: string | null; identities?: User['identities'] }
  input: { email: string; password: string }
  deps: ChangeEmailDeps
}): Promise<ChangeEmailOutcome> {
  const email = args.input.email.toLowerCase()
  const current = args.user.email
  if (!current) return { ok: false, errorCode: 'not_logged_in' }
  if (email === current.toLowerCase()) return { ok: false, errorCode: 'same_email' }

  if (!(await args.deps.verifyPassword(current, args.input.password))) {
    return { ok: false, errorCode: hasPasswordIdentity({ identities: args.user.identities }) ? 'wrong_password' : 'google_only' }
  }

  if (await args.deps.isBanned(email)) return { ok: false, errorCode: 'email_banned' }

  const error = await args.port.updateEmail(email)
  if (!error) return { ok: true, sentTo: email }

  // They asked seconds ago and a link is already in flight.
  if (error.code === 'over_email_send_rate_limit') return { ok: true, sentTo: email }
  if (error.code === 'email_exists' || /already been registered/i.test(error.message)) {
    return { ok: false, errorCode: 'email_in_use' }
  }
  console.error('[changeEmail] updateUser failed', { code: error.code, message: error.message })
  return { ok: false, errorCode: 'failed' }
}
