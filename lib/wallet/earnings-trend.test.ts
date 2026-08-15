import { describe, it, expect } from 'vitest'
import { monthOverMonthChange } from './earnings-trend'
import type { RawWalletTxnRow } from './transactions'

function txn(overrides: Partial<RawWalletTxnRow>): RawWalletTxnRow {
  return { id: 'x', type: 'prize', category: 'tournament_prize', amount: 1000, reference_id: null, note: null, created_at: '2026-08-01T00:00:00Z', ...overrides }
}
const NOW = new Date('2026-08-15T00:00:00Z')

describe('monthOverMonthChange', () => {
  it('computes percent change vs the prior calendar month for the given category', () => {
    const rows = [
      txn({ id: 'a', amount: 5000, created_at: '2026-08-05T00:00:00Z' }), // this month
      txn({ id: 'b', amount: 4000, created_at: '2026-07-05T00:00:00Z' }), // last month
    ]
    expect(monthOverMonthChange(rows, 'tournament_prize', NOW)).toBe(25)
  })
  it('is null when there is no data for the prior month (nothing to compare against)', () => {
    const rows = [txn({ id: 'a', amount: 5000, created_at: '2026-08-05T00:00:00Z' })]
    expect(monthOverMonthChange(rows, 'tournament_prize', NOW)).toBeNull()
  })
  it('ignores other categories', () => {
    const rows = [
      txn({ id: 'a', category: 'referral', amount: 5000, created_at: '2026-08-05T00:00:00Z' }),
      txn({ id: 'b', category: 'referral', amount: 4000, created_at: '2026-07-05T00:00:00Z' }),
    ]
    expect(monthOverMonthChange(rows, 'tournament_prize', NOW)).toBeNull()
  })
})
