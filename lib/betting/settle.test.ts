import { describe, it, expect } from 'vitest'
import { computePariMutuelPayouts } from './settle'

describe('computePariMutuelPayouts', () => {
  it('splits the rake-adjusted losing pool proportionally among winners', () => {
    const bets = [
      { id: 'w1', side: 'player_a' as const, stakeAmount: 100 },
      { id: 'w2', side: 'player_a' as const, stakeAmount: 300 },
      { id: 'l1', side: 'player_b' as const, stakeAmount: 400 },
    ]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    // losingPool 400, distributable = 400 * 0.9 = 360
    // w1: 100 + 360 * (100/400) = 100 + 90 = 190
    // w2: 300 + 360 * (300/400) = 300 + 270 = 570
    expect(payouts.get('w1')).toBe(190)
    expect(payouts.get('w2')).toBe(570)
    expect(payouts.get('l1')).toBe(0)
  })

  it('returns stake-back with no rake when nobody backed the losing side', () => {
    const bets = [{ id: 'w1', side: 'player_a' as const, stakeAmount: 500 }]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    expect(payouts.get('w1')).toBe(500)
  })

  it('pays nothing when nobody backed the winning side', () => {
    const bets = [{ id: 'l1', side: 'player_b' as const, stakeAmount: 500 }]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    expect(payouts.get('l1')).toBe(0)
  })

  it('handles multiple bets from the same player on the same side', () => {
    const bets = [
      { id: 'w1', side: 'player_a' as const, stakeAmount: 100 },
      { id: 'w2', side: 'player_a' as const, stakeAmount: 100 },
      { id: 'l1', side: 'player_b' as const, stakeAmount: 200 },
    ]
    const payouts = computePariMutuelPayouts(bets, 'player_a')
    // losingPool 200, distributable 180, each winner gets 100 + 180*(100/200) = 190
    expect(payouts.get('w1')).toBe(190)
    expect(payouts.get('w2')).toBe(190)
  })

  it('returns an empty map for no bets', () => {
    expect(computePariMutuelPayouts([], 'player_a').size).toBe(0)
  })
})
