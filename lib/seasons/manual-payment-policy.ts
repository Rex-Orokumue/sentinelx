export function canRecordManualPayment(args: {
  isAdmin: boolean
  tournamentStatus: string
  invitationStatus: string
  paymentStatus: string | null
  registrationStatus: string | null
  fee: number
}): boolean {
  return args.isAdmin && args.tournamentStatus === 'registration_open' && args.fee > 0 &&
    ['pending', 'accepted', 'expired'].includes(args.invitationStatus) &&
    (args.registrationStatus === null || args.registrationStatus === 'active') &&
    args.paymentStatus !== 'paid' && args.paymentStatus !== 'refunded'
}
