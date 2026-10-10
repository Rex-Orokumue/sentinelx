import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate, getReferralOverview } = vi.hoisted(() => ({ authenticate: vi.fn(), getReferralOverview: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
vi.mock('@/lib/referrals/overview', () => ({ getReferralOverview }))

import { getMyReferralsEndpoint } from './referrals'

const request = () => getMyReferralsEndpoint.handler(new Request('https://x.test/api/mobile/v1/me/referrals'))
const value = {
  username: 'owner', shareUrl: 'https://sentinelxesports.com.ng/signup?ref=owner', totalReferrals: 1,
  convertedCount: 1, totalCoinsEarned: 500, nextMilestone: { count: 5, bonusCoins: 500 },
  invited: [{ id: 'r1', name: 'Friend', avatarUrl: null, tier: 'recruit', frameUrl: null, status: 'converted', date: '2026-10-10T00:00:00Z', coinsAwarded: 250 }],
  milestoneHistory: [{ id: 'm1', description: 'First Recruit', coins: 250, date: '2026-10-10T00:00:00Z' }],
}

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ userId: 'owner-1', admin: 'admin' })
  getReferralOverview.mockReset().mockResolvedValue({ ok: true, value })
})

describe('GET /me/referrals', () => {
  it('returns the signed-in player overview without a write', async () => {
    const res = await request()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ data: value })
    expect(getReferralOverview).toHaveBeenCalledWith('admin', 'owner-1')
  })

  it.each([
    ['not_found', 404], ['load_failed', 500],
  ] as const)('maps %s to %i', async (reason, status) => {
    getReferralOverview.mockResolvedValue({ ok: false, reason })
    const res = await request()
    expect(res.status).toBe(status)
    expect((await res.json()).error.code).toBe(reason === 'not_found' ? 'not_found' : 'referrals_load_failed')
  })
})
