import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { FIXTURE_NOW } from '@/lib/testing/progress-fixtures'
import { PROFILE_TABLES, PROFILE_RPC, OWNER_ID, OWNER_USERNAME, OWNER_COIN_BALANCE } from '@/lib/testing/profile-fixtures'
import { getMyProgress } from './progress-service'
import { getPlayerProfile } from './service'

type Row = Record<string, unknown>
const NOW = new Date(FIXTURE_NOW)

function tablesWithXp(xp: number, over: Partial<Record<string, Row[]>> = {}) {
  return {
    ...PROFILE_TABLES,
    ...over,
    profiles: (PROFILE_TABLES.profiles as Row[]).map((r) => (r.id === OWNER_ID ? { ...r, xp } : r)),
  }
}
const run = (tables = PROFILE_TABLES) => {
  const user = fakeSupabase(tables, { rpc: PROFILE_RPC })
  const admin = fakeSupabase(tables)
  return { user, admin, result: getMyProgress(user.client as never, () => admin.client as never, OWNER_ID, NOW) }
}

describe('getMyProgress — tier math', () => {
  it('recruit with 250 XP → next guardian', async () => {
    const r = (await run(tablesWithXp(250)).result)!
    expect(r.membershipTier).toBe('recruit')
    expect(r.tierProgress).toEqual({ current: 'recruit', next: 'guardian', xpIntoTier: 250, xpForNextTier: 1000 })
  })

  it('guardian with 1500 XP → 500 into a 4000-XP tier', async () => {
    const r = (await run(tablesWithXp(1500)).result)!
    expect(r.membershipTier).toBe('guardian')
    expect(r.tierProgress).toEqual({ current: 'guardian', next: 'elite', xpIntoTier: 500, xpForNextTier: 4000 })
  })

  it('exactly on a threshold belongs to the higher tier', async () => {
    const r = (await run(tablesWithXp(5000)).result)!
    expect(r.membershipTier).toBe('elite')
    expect(r.tierProgress).toEqual({ current: 'elite', next: 'sentinel', xpIntoTier: 0, xpForNextTier: 10000 })
  })

  it('legend (max tier) → tierProgress is null', async () => {
    const r = (await run(tablesWithXp(60000)).result)!
    expect(r.membershipTier).toBe('legend')
    expect(r.tierProgress).toBeNull()
  })

  it('membershipTier is derived from xp (like the web XP panel), not the stored column', async () => {
    const r = (await run(tablesWithXp(1500)).result)! // fixture stores membership_tier 'guardian' for everyone; recompute agrees
    expect(r.membershipTier).toBe('guardian')
    const low = (await run(tablesWithXp(10)).result)!
    expect(low.membershipTier).toBe('recruit') // stored column still says 'guardian'
  })
})

describe('getMyProgress — the rest', () => {
  it('returns xp, sx score, sentinel tier and the coin balance', async () => {
    const r = (await run().result)!
    expect(r.xp).toBe(1500)
    expect(r.sxScore).toBe(980) // fixture: 1000 - 1 * 20
    expect(r.sentinelTier).toBe('trusted')
    expect(r.coinBalance).toBe(OWNER_COIN_BALANCE)
  })

  it('season standing equals what the profile page shows the owner (one shared implementation)', async () => {
    const progress = (await run().result)!
    const sb = fakeSupabase(PROFILE_TABLES, { rpc: PROFILE_RPC }).client as never
    const admin = fakeSupabase(PROFILE_TABLES).client as never
    const page = (await getPlayerProfile(sb, () => admin, OWNER_USERNAME, OWNER_ID))!
    expect(progress.seasonStanding).toEqual({
      seasonName: 'Season 1',
      rank: page.season.rank,
      points: page.season.points,
      pointsAtRankSixteen: page.season.pointsAtRankSixteen,
      monthlyRank: page.season.monthlyRank,
      monthlyPoints: page.season.monthlyPoints,
    })
    expect(progress.seasonStanding!.rank).toBe(1)
    expect(progress.seasonStanding!.points).toBe(40)
  })

  it('no active season → seasonStanding is null', async () => {
    const r = (await run({ ...PROFILE_TABLES, seasons: [] }).result)!
    expect(r.seasonStanding).toBeNull()
  })

  it('an unknown player id → null', async () => {
    const user = fakeSupabase(PROFILE_TABLES)
    expect(await getMyProgress(user.client as never, () => user.client as never, 'nope', NOW)).toBeNull()
  })

  it('reads the coin balance through the admin client, filtered by the caller id only', async () => {
    const { admin, result } = run()
    await result
    expect(admin.queries).toContain('sx_coins:select|eq(player_id)')
  })
})
