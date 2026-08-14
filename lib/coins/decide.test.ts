import { describe, it, expect } from 'vitest'
import { decidePurchase } from './decide'

describe('decidePurchase', () => {
  it('rejects an inactive item', () => {
    expect(decidePurchase({ item: { active: false, price_coins: 100 }, alreadyOwned: false, balance: 500 }))
      .toEqual({ ok: false, error: 'This item is no longer available.' })
  })
  it('rejects an item the player already owns', () => {
    expect(decidePurchase({ item: { active: true, price_coins: 100 }, alreadyOwned: true, balance: 500 }))
      .toEqual({ ok: false, error: 'You already own this item.' })
  })
  it('rejects insufficient balance', () => {
    expect(decidePurchase({ item: { active: true, price_coins: 600 }, alreadyOwned: false, balance: 500 }))
      .toEqual({ ok: false, error: 'Not enough SX Coins.' })
  })
  it('allows a valid purchase', () => {
    expect(decidePurchase({ item: { active: true, price_coins: 500 }, alreadyOwned: false, balance: 500 }))
      .toEqual({ ok: true })
  })
})
