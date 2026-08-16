export const WAGER_FEE_RATE = 0.05 // spec §5 — 5% platform fee on the losing pool
export const MIN_WAGER_STAKE = 50
export const MAX_WAGER_STAKE = 2000
export const WAGER_WINDOW_CLOSE_MINUTES = 15

export type WagerMatch = {
  status: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
  is_full_day: boolean
}

// Wagering opens the moment both players are confirmed into a scheduled
// match and closes 15 minutes before scheduled_at — EXCEPT for a full-day
// match, where scheduled_at is midnight WAT marking the START of the whole
// play day (see lib/tournaments/round-schedule.ts), not a kickoff instant.
// A player can play at any point during that day, so "15 minutes before
// scheduled_at" would close the window before the day has even begun —
// confirmed live: every currently-scheduled match in production is
// full-day, and all of them read as closed under the old literal-15-minute
// rule. This now mirrors lib/betting/market.ts's bettingOpen, which already
// got this right (lockAt = scheduled_at + 24h for full-day matches) — the
// original "stays literal to the spec, no full-day exception" comment here
// was wrong in practice; the spec's authors didn't anticipate full-day
// scheduling when they wrote the 15-minute rule.
export function wagerWindowOpen(match: WagerMatch, now: Date = new Date()): boolean {
  if (match.status !== 'scheduled') return false
  if (!match.player_a_id || !match.player_b_id) return false
  if (!match.scheduled_at) return false
  const scheduledAt = new Date(match.scheduled_at).getTime()
  const closesAt = match.is_full_day
    ? scheduledAt + 86_400_000
    : scheduledAt - WAGER_WINDOW_CLOSE_MINUTES * 60_000
  return now.getTime() < closesAt
}

export type WagerPools = { playerA: number; playerB: number }
export type WagerSide = 'player_a' | 'player_b'

// "What would this stake return right now if the window closed this
// instant" — informational only for the widget's live "Potential win"
// figure; real settlement math is computeWagerPayouts in settle.ts, applied
// to the actual pool at result-confirmation time.
export function estimateWagerPayout(pools: WagerPools, side: WagerSide, stake: number): number {
  const thisPool = (side === 'player_a' ? pools.playerA : pools.playerB) + stake
  const otherPool = side === 'player_a' ? pools.playerB : pools.playerA
  if (otherPool <= 0) return stake
  return stake + Math.floor(otherPool * (1 - WAGER_FEE_RATE) * (stake / thisPool))
}
