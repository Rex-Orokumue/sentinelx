import { describe, it, expect, vi } from 'vitest'
import { recordDailyLogin } from './actions'

vi.mock('@/lib/coins/service', () => ({ awardCoins: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))

function fakeAdmin(profile: { last_login_date: string | null; login_streak: number }) {
  const updates: Record<string, unknown>[] = []
  return {
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }),
        update: (vals: Record<string, unknown>) => ({
          eq: async () => { updates.push(vals); Object.assign(profile, vals); return { data: null, error: null } },
        }),
      }),
    },
    updates,
  }
}

describe('recordDailyLogin', () => {
  it('is idempotent for a second call the same day', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-02', login_streak: 3 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-01T23:30:00Z'))
    expect(updates).toEqual([])
    expect(awardCoins).not.toHaveBeenCalled()
  })

  it('awards daily coins/xp and bumps the streak on a new day', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 3 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))
    expect(updates).toEqual([{ last_login_date: '2026-01-02', login_streak: 4 }])
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
  })

  it('awards the 7-day streak bonus on day 7', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client } = fakeAdmin({ last_login_date: '2026-01-06', login_streak: 6 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-07T10:00:00Z'))
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 100, 'login_streak', null)
  })

  it('awards the 30-day streak bonus on day 30, not the 7-day one', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    const { client } = fakeAdmin({ last_login_date: '2026-01-29', login_streak: 29 })
    await recordDailyLogin(client as never, 'p1', new Date('2026-01-30T10:00:00Z'))
    expect(awardCoins).toHaveBeenCalledWith(client, 'p1', 200, 'login_streak', null)
    expect(awardCoins).not.toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
  })

  it('never throws even if a downstream call rejects', async () => {
    const { awardCoins } = await import('@/lib/coins/service')
    vi.mocked(awardCoins).mockRejectedValueOnce(new Error('boom'))
    const { client } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 1 })
    await expect(recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))).resolves.toBeUndefined()
  })
})
