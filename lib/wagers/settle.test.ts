import { describe, it, expect } from 'vitest'
import { computeWagerPayouts } from './settle'

describe('computeWagerPayouts', () => {
  it('splits the fee-adjusted losing pool pro-rata among winners, and takes the 5% platform fee', () => {
    // Spec §5 worked example: 3 bettors x100 on methio (winner), 1 bettor x200 on Arole.
    const wagers = [
      { id: 'w1', bettorId: 'p1', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'w2', bettorId: 'p2', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'w3', bettorId: 'p3', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'l1', bettorId: 'p4', pickPlayerId: 'arole', stakeCoins: 200 },
    ]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(10) // 5% of 200
    // distributable 190, each of 3 winners: 100 + floor(190 * 100/300) = 100 + 63 = 163
    expect(payouts.get('w1')).toBe(163)
    expect(payouts.get('w2')).toBe(163)
    expect(payouts.get('w3')).toBe(163)
    expect(payouts.get('l1')).toBe(0)
  })

  it('takes no fee and pays nothing when nobody backed the winner', () => {
    const wagers = [{ id: 'l1', bettorId: 'p1', pickPlayerId: 'arole', stakeCoins: 200 }]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(0)
    expect(payouts.get('l1')).toBe(0)
  })

  it('returns stake-back with no fee when nobody backed the loser', () => {
    const wagers = [{ id: 'w1', bettorId: 'p1', pickPlayerId: 'methio', stakeCoins: 500 }]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(0)
    expect(payouts.get('w1')).toBe(500)
  })
})
