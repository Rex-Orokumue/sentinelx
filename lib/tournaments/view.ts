export type RegView =
  | 'guest'
  | 'can_register'
  | 'complete_payment'
  | 'registered'
  | 'waitlisted'
  | 'full'
  | 'closed'
  | 'ended'
  | 'invitation_only'

// Precedence: a paid player always sees "registered"; a waitlisted
// registration shows next. The tournament lifecycle (ended/closed) wins
// over the open-registration sub-states, and invitation-only tournaments
// are gated before login/capacity checks — an invited-and-paid player still
// resolves to 'registered' above, so this only affects everyone else.
export function resolveRegistrationView(args: {
  status: string
  loggedIn: boolean
  paidCount: number
  maxPlayers: number | null
  existingStatus: string | null
  registrationStatus?: string | null
  invitationOnly?: boolean
}): RegView {
  if (args.existingStatus === 'paid') return 'registered'
  if (args.registrationStatus === 'waitlisted') return 'waitlisted'
  if (args.status === 'completed') return 'ended'
  if (args.status === 'registration_closed' || args.status === 'active') return 'closed'
  if (args.invitationOnly) return 'invitation_only'
  if (!args.loggedIn) return 'guest'
  if (args.existingStatus === 'pending') return 'complete_payment'
  if (args.maxPlayers != null && args.paidCount >= args.maxPlayers) return 'full'
  return 'can_register'
}
