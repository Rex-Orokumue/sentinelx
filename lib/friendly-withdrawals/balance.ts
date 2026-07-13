export function computeStakedBalance(
  wins: { stakeAmount: number }[],
  withdrawals: { status: string; amount: number }[],
): number {
  const earned = wins.reduce((sum, w) => sum + w.stakeAmount * 2, 0)
  const reserved = withdrawals
    .filter((w) => w.status === 'pending' || w.status === 'paid')
    .reduce((sum, w) => sum + w.amount, 0)
  return earned - reserved
}
