import { describe, it, expect, vi } from 'vitest'
import { recordDailyLogin } from './actions'

vi.mock('@/lib/coins/service', () => ({ recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))

function fakeAdmin(profile: {
  last_login_date: string | null
  login_streak: number
  deletion_requested_at?: string | null
}) {
  const full = { deletion_requested_at: null, ...profile }
  const updates: Record<string, unknown>[] = []
  return {
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: full }) }) }),
        update: (vals: Record<string, unknown>) => ({
          eq: async () => { updates.push(vals); Object.assign(full, vals); return { data: null, error: null } },
        }),
      }),
    },
    updates,
  }
}

describe('recordDailyLogin', () => {
  it('is idempotent for a second call the same day, and still reports the current streak', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-02', login_streak: 3 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-01T23:30:00Z'))
    expect(updates).toEqual([])
    expect(recordCoinTransaction).not.toHaveBeenCalled()
    expect(result).toEqual({
      awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 3, milestone: null, deletionRequestedAt: null,
    })
  })

  it('awards daily coins/xp, bumps the streak on a new day, and reports what it awarded', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 3, deletion_requested_at: null })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))
    expect(updates).toEqual([{ last_login_date: '2026-01-02', login_streak: 4 }])
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 5, xpAwarded: 20, streak: 4, milestone: null, deletionRequestedAt: null,
    })
  })

  it('awards the 7-day streak bonus on day 7 and reports the "week" milestone', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client } = fakeAdmin({ last_login_date: '2026-01-06', login_streak: 6 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-07T10:00:00Z'))
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 100, 'login_streak', null)
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 55, xpAwarded: 120, streak: 7, milestone: 'week', deletionRequestedAt: null,
    })
  })

  it('awards the 30-day streak bonus on day 30, not the 7-day one, and reports the "month" milestone', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { client } = fakeAdmin({ last_login_date: '2026-01-29', login_streak: 29 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-30T10:00:00Z'))
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 200, 'login_streak', null)
    expect(recordCoinTransaction).not.toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 205, xpAwarded: 520, streak: 30, milestone: 'month', deletionRequestedAt: null,
    })
  })

  it('passes deletion_requested_at through untouched either way', async () => {
    const { client: pending } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 3, deletion_requested_at: '2026-01-05T00:00:00Z' })
    const result = await recordDailyLogin(pending as never, 'p1', new Date('2026-01-01T23:30:00Z'))
    expect(result.deletionRequestedAt).toBe('2026-01-05T00:00:00Z')
  })

  it('never throws even if a downstream call rejects, and still reports the intended award', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    vi.mocked(recordCoinTransaction).mockRejectedValueOnce(new Error('boom'))
    const { client } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 1 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 5, xpAwarded: 20, streak: 2, milestone: null, deletionRequestedAt: null,
    })
  })

  it('never throws and reports nothing awarded when the profile read itself fails', async () => {
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }),
    }
    await expect(recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))).resolves.toEqual({
      awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 0, milestone: null, deletionRequestedAt: null,
    })
  })
})
