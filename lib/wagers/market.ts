export const WAGER_FEE_RATE = 0.05 // spec §5 — 5% platform fee on the losing pool
export const MIN_WAGER_STAKE = 50
export const MAX_WAGER_STAKE = 2000
export const WAGER_WINDOW_CLOSE_MINUTES = 15

export type WagerMatch = {
  status: string
  scheduled_at: string | null
  player_a_id: string | null
  player_b_id: string | null
}

// Wagering opens the moment both players are confirmed into a scheduled
// match and closes a fixed 15 minutes before scheduled_at (spec §5). Unlike
// the naira betting window (lib/betting/market.ts's bettingOpen), there is
// no full-day-match carve-out here — the coin wagering spec states the
// 15-minute rule with no exception, so this stays literal to it rather than
// inventing an undocumented extension.
export function wagerWindowOpen(match: WagerMatch, now: Date = new Date()): boolean {
  if (match.status !== 'scheduled') return false
  if (!match.player_a_id || !match.player_b_id) return false
  if (!match.scheduled_at) return false
  const closesAt = new Date(match.scheduled_at).getTime() - WAGER_WINDOW_CLOSE_MINUTES * 60_000
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
