import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import {
  PROFILE_TABLES, PROFILE_RPC, OWNER_ID, OWNER_USERNAME, OWNER_COIN_BALANCE, TARGET_USERNAME, DELETED_USERNAME,
} from '@/lib/testing/profile-fixtures'
import { getPlayerProfile, searchPlayers } from './service'

const sb = (user: { id: string } | null = null) => fakeSupabase(PROFILE_TABLES, { user, rpc: PROFILE_RPC }).client as never
function lazyAdmin() {
  const fake = fakeSupabase(PROFILE_TABLES)
  const built = { count: 0 }
  return { getAdmin: () => { built.count++; return fake.client as never }, built, fake }
}

describe('getPlayerProfile', () => {
  it('returns null for an unknown username', async () => {
    expect(await getPlayerProfile(sb(), lazyAdmin().getAdmin, 'nobody', null)).toBeNull()
  })

  it('returns null for a deleted account', async () => {
    expect(await getPlayerProfile(sb(), lazyAdmin().getAdmin, DELETED_USERNAME, null)).toBeNull()
  })

  it('a visitor gets no coin balance and no monthly standing', async () => {
    const r = await getPlayerProfile(sb(), lazyAdmin().getAdmin, TARGET_USERNAME, null)
    expect(r!.isOwner).toBe(false)
    expect(r!.coinBalance).toBeNull()
    expect(r!.season.monthlyRank).toBeNull()
    expect(r!.season.monthlyPoints).toBe(0)
  })

  it('the owner gets the coin balance and a season standing', async () => {
    const r = await getPlayerProfile(sb(), lazyAdmin().getAdmin, OWNER_USERNAME, OWNER_ID)
    expect(r!.isOwner).toBe(true)
    expect(r!.coinBalance).toBe(OWNER_COIN_BALANCE)
    expect(r!.season.rank).toBe(1)
    expect(r!.season.points).toBe(40)
  })

  it('a signed-in viewer who is not the owner is not treated as the owner', async () => {
    const r = await getPlayerProfile(sb(), lazyAdmin().getAdmin, TARGET_USERNAME, OWNER_ID)
    expect(r!.isOwner).toBe(false)
    expect(r!.coinBalance).toBeNull()
  })

  it('keeps ALL achievement cells (the mapper, not the service, hides locked ones) and computes the streak', async () => {
    const r = await getPlayerProfile(sb(), lazyAdmin().getAdmin, TARGET_USERNAME, null)
    expect(r!.achievementCells).toHaveLength(5)
    expect(r!.unlockedSlugs.sort()).toEqual(['champion', 'first-blood'])
    expect(r!.profile.currentStreak).toBe(2)
    expect(r!.profile.followerCount).toBe(2)
    expect(r!.titles.map((t) => t.tournamentTitle)).toEqual(['Masters Cup'])
  })

  it('does not construct the admin client when there is nothing to read with it', async () => {
    const noSeason = { ...PROFILE_TABLES, seasons: [] }
    const admin = lazyAdmin()
    const client = fakeSupabase(noSeason, { rpc: PROFILE_RPC }).client as never
    await getPlayerProfile(client, admin.getAdmin, TARGET_USERNAME, null)
    expect(admin.built.count).toBe(0)
  })
})

describe('searchPlayers', () => {
  it('excludes the viewer only when an id is given', async () => {
    const all = await searchPlayers(sb(), '', null)
    const without = await searchPlayers(sb(), '', 'p1')
    expect(all.some((p) => p.username === 'player1')).toBe(true)
    expect(without.some((p) => p.username === 'player1')).toBe(false)
  })

  it('records the escaped or() filter for a term', async () => {
    const fake = fakeSupabase(PROFILE_TABLES)
    await searchPlayers(fake.client as never, '50%_,(x)', null)
    expect(fake.queries).toEqual(['profiles:select|or'])
  })

  it('escapes ilike wildcards and PostgREST filter-syntax characters in the or() string', async () => {
    let received = ''
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'limit', 'neq']) chain[m] = () => chain
    chain.or = (f: string) => { received = f; return chain }
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
    await searchPlayers({ from: () => chain } as never, '50%_,(x)', null)
    expect(received).toBe(String.raw`username.ilike.%50\%\_\,\(x\)%,display_name.ilike.%50\%\_\,\(x\)%`)
  })
})
