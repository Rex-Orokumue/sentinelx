import { describe, it, expect } from 'vitest'
import { WALLET_NAV_ITEMS } from './nav'

describe('WALLET_NAV_ITEMS', () => {
  it('marks deposit and referrals correctly (deposit live, referrals locked)', () => {
    const deposit = WALLET_NAV_ITEMS.find((i) => i.href === '/dashboard/wallet/deposit')
    const referrals = WALLET_NAV_ITEMS.find((i) => i.href === '/dashboard/wallet/referrals')
    expect(deposit?.locked).toBe(false)
    expect(referrals?.locked).toBe(true)
  })
  it('every item has a unique href', () => {
    const hrefs = WALLET_NAV_ITEMS.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
