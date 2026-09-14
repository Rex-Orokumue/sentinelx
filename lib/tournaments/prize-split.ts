export interface PrizeShare {
  playerId: string
  amountNaira: number
}

// Splits a prize evenly across a squad's roster (spec §8 — "prize splits
// across the roster"). Prizes are whole Naira, never fractional, so any
// remainder from integer division goes one Naira at a time to the roster's
// earliest members (stable input order) — never to the captain specifically,
// since captaincy carries no extra prize entitlement anywhere else in this
// system.
export function splitPrizeAcrossRoster(prizeNaira: number, rosterPlayerIds: string[]): PrizeShare[] {
  if (prizeNaira <= 0 || rosterPlayerIds.length === 0) return []
  const base = Math.floor(prizeNaira / rosterPlayerIds.length)
  const remainder = prizeNaira - base * rosterPlayerIds.length
  return rosterPlayerIds.map((playerId, i) => ({ playerId, amountNaira: base + (i < remainder ? 1 : 0) }))
}
