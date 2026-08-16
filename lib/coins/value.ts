// Anchor rate for the entire SX Coin economy (spec §2,
// docs/superpowers/specs/2026-08-15-coin-economy-extension.md). Every coin
// price or earn amount shown anywhere in the UI must derive from these
// constants — never hardcode a naira figure next to a coin amount. Fixed at
// the platform level, not adjustable per-player or per-tournament.
export const COINS_PER_NAIRA = 2 // 2 coins = ₦1
export const NAIRA_PER_COIN = 0.5 // 1 coin = ₦0.50
export const COINS_PER_ENTRY = 1000 // full tournament entry (1,000 coins = ₦500)
export const COINS_HALF_ENTRY = 500 // half-price entry (500 coins = ₦250)

// Every coin amount this platform actually offers is a multiple of 2, so the
// naira equivalent is always a whole naira — Math.round is a no-op safety
// net, not a source of drift.
export function coinsToNaira(coins: number): number {
  return Math.round(coins * NAIRA_PER_COIN)
}

// "500 coins (₦250)" — the one place this string is built, so every coin
// price in the UI reads identically (store, entry discount, wager, boost).
export function formatCoins(coins: number): string {
  return `${coins.toLocaleString()} coins (₦${coinsToNaira(coins).toLocaleString('en-NG')})`
}
