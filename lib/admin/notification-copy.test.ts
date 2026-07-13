import { describe, it, expect } from 'vitest'
import {
  exchangeListingNotification,
  resultNotification,
  withdrawalNotification,
  sortByCreatedAtDesc,
  countByHref,
  type AdminNotificationItem,
} from './notification-copy'

describe('exchangeListingNotification', () => {
  it('builds title/body/link from the listing row', () => {
    const item = exchangeListingNotification({
      title: 'PS5 Controller',
      sellerName: 'john123',
      createdAt: '2026-07-10T10:00:00Z',
    })
    expect(item).toEqual({
      type: 'exchange_listing_pending',
      title: 'Listing pending review',
      body: 'PS5 Controller — john123',
      link: '/admin/exchange',
      createdAt: '2026-07-10T10:00:00Z',
    })
  })
})

describe('resultNotification', () => {
  it('labels a needs-review result', () => {
    const item = resultNotification({
      type: 'result_needs_review',
      tournamentTitle: 'Lagos Cup',
      playerAName: 'Ade',
      playerBName: 'Bola',
      createdAt: '2026-07-10T11:00:00Z',
    })
    expect(item.title).toBe('Result needs review')
    expect(item.body).toBe('Lagos Cup — Ade vs Bola')
    expect(item.link).toBe('/admin/results')
    expect(item.type).toBe('result_needs_review')
  })

  it('labels a disputed result', () => {
    const item = resultNotification({
      type: 'result_disputed',
      tournamentTitle: 'Lagos Cup',
      playerAName: 'Ade',
      playerBName: 'Bola',
      createdAt: '2026-07-10T11:00:00Z',
    })
    expect(item.title).toBe('Result disputed')
    expect(item.link).toBe('/admin/results')
    expect(item.type).toBe('result_disputed')
  })
})

describe('withdrawalNotification', () => {
  it('builds a withdrawal notification with naira formatting', () => {
    const item = withdrawalNotification({
      type: 'withdrawal_pending',
      username: 'chi_baller',
      amount: 15000,
      createdAt: '2026-07-10T12:00:00Z',
    })
    expect(item.title).toBe('Withdrawal request')
    expect(item.body).toBe('chi_baller — ₦15,000')
    expect(item.link).toBe('/admin/wallet')
  })
})

describe('sortByCreatedAtDesc', () => {
  it('sorts newest first', () => {
    const items: AdminNotificationItem[] = [
      { type: 'exchange_listing_pending', title: 'a', body: '', link: '/x', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'exchange_listing_pending', title: 'b', body: '', link: '/x', createdAt: '2026-07-03T00:00:00Z' },
      { type: 'exchange_listing_pending', title: 'c', body: '', link: '/x', createdAt: '2026-07-02T00:00:00Z' },
    ]
    expect(sortByCreatedAtDesc(items).map((i) => i.title)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const items: AdminNotificationItem[] = [
      { type: 'exchange_listing_pending', title: 'a', body: '', link: '/x', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'exchange_listing_pending', title: 'b', body: '', link: '/x', createdAt: '2026-07-03T00:00:00Z' },
    ]
    const copy = [...items]
    sortByCreatedAtDesc(items)
    expect(items).toEqual(copy)
  })
})

describe('countByHref', () => {
  it('groups items by link and counts them', () => {
    const items: AdminNotificationItem[] = [
      { type: 'exchange_listing_pending', title: '', body: '', link: '/admin/exchange', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'exchange_listing_pending', title: '', body: '', link: '/admin/exchange', createdAt: '2026-07-01T00:00:00Z' },
      { type: 'result_disputed', title: '', body: '', link: '/admin/results', createdAt: '2026-07-01T00:00:00Z' },
    ]
    expect(countByHref(items)).toEqual({ '/admin/exchange': 2, '/admin/results': 1 })
  })

  it('returns an empty object for no items', () => {
    expect(countByHref([])).toEqual({})
  })
})
