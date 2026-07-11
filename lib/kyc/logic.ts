export function maskAccountNumber(accountNumber: string): string {
  return `•••${accountNumber.slice(-4)}`
}

export type KycPanelMode = 'form' | 'pending' | 'verified'

export function kycPanelMode(kycStatus: string): KycPanelMode {
  if (kycStatus === 'verified') return 'verified'
  if (kycStatus === 'pending') return 'pending'
  return 'form' // 'unverified' | 'failed' | any unrecognized value
}
