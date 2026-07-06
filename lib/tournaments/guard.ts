export type RegisterGuard =
  | { ok: true }
  | { ok: false; reason: 'not_open' | 'full' | 'already_registered' }

// Precedence: a paid player is "already_registered" regardless of status;
// then status must be open; then capacity. A 'pending' row is allowed through
// so the player can retry payment.
export function checkCanRegister(args: {
  status: string
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
}): RegisterGuard {
  if (args.existingStatus === 'paid') return { ok: false, reason: 'already_registered' }
  if (args.status !== 'registration_open') return { ok: false, reason: 'not_open' }
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) {
    return { ok: false, reason: 'full' }
  }
  return { ok: true }
}
