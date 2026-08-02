import { RAKE_RATE, type Side } from './market'

export type SettleBet = { id: string; side: Side; stakeAmount: number }

// Pure pari-mutuel split: the losing side's pool, minus the platform rake,
// is redistributed to winners proportional to their stake. Payouts are
// rounded down (Math.floor) to whole naira — wallets deal in integers, and
// under-paying by a fraction of a naira across many winners is preferable
// to a rounding-driven over-payment that could push the pool negative.
export function computePariMutuelPayouts(bets: SettleBet[], winningSide: Side): Map<string, number> {
  const payouts = new Map<string, number>()
  const winners = bets.filter((b) => b.side === winningSide)
  const losers = bets.filter((b) => b.side !== winningSide)
  const winningPool = winners.reduce((sum, b) => sum + b.stakeAmount, 0)
  const losingPool = losers.reduce((sum, b) => sum + b.stakeAmount, 0)

  for (const bet of losers) payouts.set(bet.id, 0)

  if (winningPool === 0) {
    // Nobody backed the actual winner — no payouts, losing pool isn't
    // redistributed since there's no one to redistribute it to.
    return payouts
  }

  const distributable = losingPool === 0 ? 0 : losingPool * (1 - RAKE_RATE)
  for (const bet of winners) {
    const payout = bet.stakeAmount + Math.floor(distributable * (bet.stakeAmount / winningPool))
    payouts.set(bet.id, payout)
  }
  return payouts
}
