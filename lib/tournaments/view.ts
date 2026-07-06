export type RegView =
  | 'guest'
  | 'can_register'
  | 'complete_payment'
  | 'registered'
  | 'full'
  | 'closed'
  | 'ended'

// Precedence: a paid player always sees "registered". Otherwise the tournament
// lifecycle (ended / closed) wins over the open-registration sub-states.
export function resolveRegistrationView(args: {
  status: string
  loggedIn: boolean
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
}): RegView {
  if (args.existingStatus === 'paid') return 'registered'
  if (args.status === 'completed') return 'ended'
  if (args.status === 'registration_closed' || args.status === 'active') return 'closed'
  // status is 'registration_open' (draft pages 404 before reaching here).
  if (!args.loggedIn) return 'guest'
  if (args.existingStatus === 'pending') return 'complete_payment'
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) return 'full'
  return 'can_register'
}
