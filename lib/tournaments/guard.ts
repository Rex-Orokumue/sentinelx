export type RegisterGuard =
  | { ok: true }
  | { ok: false; reason: 'not_open' | 'full' | 'already_registered' | 'invitation_only' }

// Precedence: a paid player is "already_registered" regardless of status;
// then invitation-only tournaments reject the public form outright; then
// status must be open; then capacity. A 'pending' row is allowed through
// so the player can retry payment.
export function checkCanRegister(args: {
  status: string
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
  invitationOnly?: boolean
}): RegisterGuard {
  if (args.existingStatus === 'paid') return { ok: false, reason: 'already_registered' }
  if (args.invitationOnly) return { ok: false, reason: 'invitation_only' }
  if (args.status !== 'registration_open') return { ok: false, reason: 'not_open' }
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) {
    return { ok: false, reason: 'full' }
  }
  return { ok: true }
}
