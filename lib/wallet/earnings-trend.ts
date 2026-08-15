import type { RawWalletTxnRow } from './transactions'

// "Total Earned +18%" on the Tournament Winnings card — spec §3.4, scoped
// (per the spec's own wording) to tournament winnings only. Real data only:
// returns null rather than a fabricated 0%/∞% when there's nothing to
// compare against.
export function monthOverMonthChange(rows: RawWalletTxnRow[], category: string, now: Date): number | null {
  const thisMonthKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}`
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const lastMonthKey = `${lastMonthDate.getUTCFullYear()}-${lastMonthDate.getUTCMonth()}`

  let thisMonthTotal = 0
  let lastMonthTotal = 0
  for (const r of rows) {
    if (r.category !== category || r.amount <= 0) continue
    const d = new Date(r.created_at)
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    if (key === thisMonthKey) thisMonthTotal += r.amount
    else if (key === lastMonthKey) lastMonthTotal += r.amount
  }

  if (lastMonthTotal === 0) return null
  return Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
}
