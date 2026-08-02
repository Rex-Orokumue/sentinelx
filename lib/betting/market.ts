export const RAKE_RATE = 0.10

export type MatchForBetting = {
  status: string
  scheduled_at: string | null
  betting_locked: boolean
}

// Betting opens the moment a match is scheduled and closes automatically at
// its scheduled start time, or earlier if admin manually locks it. Once
// closed by either path there is no reopening — reopening after players may
// have watched the outcome live would recreate the exact insider-betting
// risk this avoids.
export function bettingOpen(match: MatchForBetting, now: Date = new Date()): boolean {
  if (match.betting_locked) return false
  if (match.status !== 'scheduled') return false
  if (!match.scheduled_at) return true
  return now < new Date(match.scheduled_at)
}

export type SidePools = { playerA: number; playerB: number }
export type Side = 'player_a' | 'player_b'

// "What would a ₦1 stake on this side return right now if the pool closed
// this instant" — informational only, never used for settlement math (that's
// computePariMutuelPayouts in settle.ts, applied to the pool at lock time).
export function impliedPayoutMultiplier(pools: SidePools, side: Side): number | null {
  const thisPool = side === 'player_a' ? pools.playerA : pools.playerB
  const otherPool = side === 'player_a' ? pools.playerB : pools.playerA
  if (thisPool <= 0) return null
  if (otherPool <= 0) return 1
  return 1 + (otherPool * (1 - RAKE_RATE)) / thisPool
}
