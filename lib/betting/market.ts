export const RAKE_RATE = 0.10

export type MatchForBetting = {
  status: string
  scheduled_at: string | null
  betting_locked: boolean
  is_full_day: boolean
}

// Betting opens the moment a match is scheduled and closes automatically at
// its scheduled start time, or earlier if admin manually locks it. Once
// closed by either path there is no reopening — reopening after players may
// have watched the outcome live would recreate the exact insider-betting
// risk this avoids.
//
// For a full-day match, scheduled_at is midnight WAT — the START of the
// match's play day (see lib/tournaments/round-schedule.ts), not a kickoff
// instant. Players can play any time during that day, so the lock instant
// is the end of that day (scheduled_at + 24h), not scheduled_at itself. The
// pure +24h add is safe without timezone conversion because WAT has no DST
// — same reasoning already used by addRoundGapDays in round-schedule.ts.
export function bettingOpen(match: MatchForBetting, now: Date = new Date()): boolean {
  if (match.betting_locked) return false
  if (match.status !== 'scheduled') return false
  if (!match.scheduled_at) return true
  const lockAt = new Date(match.scheduled_at).getTime() + (match.is_full_day ? 86_400_000 : 0)
  return now.getTime() < lockAt
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
