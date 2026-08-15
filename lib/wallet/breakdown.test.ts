import { describe, it, expect } from 'vitest'
import { summarizeEarningsByCategory } from './breakdown'

describe('summarizeEarningsByCategory', () => {
  it('sums credits (positive amounts) grouped by category, ignoring debits', () => {
    const result = summarizeEarningsByCategory([
      { amount: 5000, category: 'tournament_prize' },
      { amount: 3000, category: 'tournament_prize' },
      { amount: 500, category: 'referral' },
      { amount: -2000, category: 'withdrawal' }, // debit — excluded from an "earnings" breakdown
      { amount: 1000, category: null }, // uncategorized legacy row — excluded, not silently bucketed
    ])
    expect(result).toEqual({ tournament_prize: 8000, referral: 500 })
  })

  it('returns an empty object for no transactions', () => {
    expect(summarizeEarningsByCategory([])).toEqual({})
  })
})
