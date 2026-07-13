export const REFERRAL_CREDIT_NGN = 100
export const REFERRAL_MIN_COUNT = 5

// Derived, never stored: total earned minus whatever is already spoken for
// by a pending or paid request. Rejected requests free the amount back up.
export function computeReferralBalance(
  referralCount: number,
  withdrawals: { status: string; amount: number }[],
): number {
  const earned = referralCount * REFERRAL_CREDIT_NGN
  const reserved = withdrawals
    .filter((w) => w.status === 'pending' || w.status === 'paid')
    .reduce((sum, w) => sum + w.amount, 0)
  return earned - reserved
}

export function isEligibleForReferralWithdrawal(referralCount: number): boolean {
  return referralCount >= REFERRAL_MIN_COUNT
}
