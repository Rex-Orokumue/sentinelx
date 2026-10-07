import type { AccountAuthPort } from './account-auth-port'

export type UnlinkErrorCode =
  | 'password_required'
  | 'not_logged_in'
  | 'wrong_password'
  | 'not_linked'
  | 'last_identity'
  | 'unavailable'
  | 'failed'

export type UnlinkOutcome = { ok: true } | { ok: false; errorCode: UnlinkErrorCode }

// Extracted from lib/auth/identities.ts unlinkGoogle(). The password does two jobs: it proves
// the session belongs to the account holder, and it proves a working password exists so removing
// Google cannot strand the account. Other sessions are revoked only after the identity is
// actually gone: unlinking is a "lock the other person out" action.
export async function performUnlinkGoogle(args: {
  port: AccountAuthPort
  user: { email?: string | null }
  password: string
  verifyPassword: (email: string, password: string) => Promise<boolean>
}): Promise<UnlinkOutcome> {
  if (!args.password) return { ok: false, errorCode: 'password_required' }
  if (!args.user.email) return { ok: false, errorCode: 'not_logged_in' }
  if (!(await args.verifyPassword(args.user.email, args.password))) return { ok: false, errorCode: 'wrong_password' }

  const identities = await args.port.listIdentities()
  if (!identities) {
    console.error('[unlinkGoogle] listing identities failed')
    return { ok: false, errorCode: 'failed' }
  }
  const google = identities.find((i) => i.provider === 'google')
  if (!google) return { ok: false, errorCode: 'not_linked' }
  if (identities.length < 2) return { ok: false, errorCode: 'last_identity' }

  const error = await args.port.unlinkIdentity(google.identityId)
  if (error) {
    console.error('[unlinkGoogle] unlinkIdentity failed', { code: error.code, message: error.message })
    // Both link and unlink sit behind the project's Manual Linking toggle; retrying cannot help.
    if (error.code === 'manual_linking_disabled') return { ok: false, errorCode: 'unavailable' }
    return { ok: false, errorCode: 'failed' }
  }

  await args.port.signOutOthers()
  return { ok: true }
}
