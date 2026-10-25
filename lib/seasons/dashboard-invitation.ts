export interface DashboardInvitation {
  id: string
  tournament_id: string
  status: string
  expires_at: string
  rank_at_invite: number
  tournament: { title: string; slug: string; registration_fee: number } | { title: string; slug: string; registration_fee: number }[] | null
}

export function selectActionableInvitation<T extends DashboardInvitation>(
  invitations: T[],
  registrations: { tournament_id: string; payment_status: string }[],
  now: Date,
): T | null {
  return invitations.find((invitation) => {
    if (!invitation.tournament) return false
    if (invitation.status === 'pending') return new Date(invitation.expires_at) > now
    if (invitation.status !== 'accepted') return false
    const registration = registrations.find((row) => row.tournament_id === invitation.tournament_id)
    return registration?.payment_status !== 'paid'
  }) ?? null
}
