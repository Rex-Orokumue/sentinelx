import { describe, it, expect } from 'vitest'
import { COINS_PER_NAIRA, NAIRA_PER_COIN, COINS_PER_ENTRY, COINS_HALF_ENTRY, coinsToNaira, formatCoins } from './value'

describe('coin value constants', () => {
  it('are internally consistent (1 coin = ₦0.50, 2 coins = ₦1)', () => {
    expect(NAIRA_PER_COIN).toBe(0.5)
    expect(COINS_PER_NAIRA).toBe(2)
    expect(COINS_PER_NAIRA * NAIRA_PER_COIN).toBe(1)
  })

  it('anchors full/half tournament entry to ₦500/₦250', () => {
    expect(coinsToNaira(COINS_PER_ENTRY)).toBe(500)
    expect(coinsToNaira(COINS_HALF_ENTRY)).toBe(250)
  })
})

describe('formatCoins', () => {
  it('shows the coin amount with its naira equivalent', () => {
    expect(formatCoins(500)).toBe('500 coins (₦250)')
    expect(formatCoins(200)).toBe('200 coins (₦100)')
  })
})
