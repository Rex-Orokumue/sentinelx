import { describe, it, expect } from 'vitest'
import { getReferralOverview } from './overview'

const OWNER = 'owner-1'
const NOW = '2026-10-10T10:00:00.000Z'

function fakeAdmin(args: {
  username?: string | null
  profileMissing?: boolean
  referrals?: unknown[]
  coinRows?: unknown[]
  milestoneRows?: unknown[]
  achievements?: unknown[]
  failTable?: string
} = {}) {
  const queries: { table: string; filters: [string, unknown][]; sources: unknown[] }[] = []
  let coinQueries = 0
  const admin = {
    from(table: string) {
      const query = { table, filters: [] as [string, unknown][], sources: [] as unknown[] }
      queries.push(query)
      const result = () => ({
        data: table === 'profiles' ? (args.profileMissing ? null : { username: args.username === undefined ? 'player 1' : args.username })
          : table === 'referrals' ? (args.referrals ?? [])
            : table === 'achievements' ? (args.achievements ?? [])
              : ++coinQueries === 1 ? (args.coinRows ?? []) : (args.milestoneRows ?? []),
        error: table === args.failTable ? { message: 'read failed' } : null,
      })
      const chain = {
        select: (_columns: string) => chain,
        eq: (column: string, value: unknown) => { query.filters.push([column, value]); return chain },
        in: (_column: string, values: unknown[]) => { query.sources.push(...values); return chain },
        order: () => chain,
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return chain
    },
  }
  return { admin: admin as never, queries }
}

describe('getReferralOverview', () => {
  it('scopes every player read, maps invite status, and totals only referral coins', async () => {
    const { admin, queries } = fakeAdmin({
      username: 'player 1',
      referrals: [
        { id: 'r1', status: 'pending', created_at: NOW, converted_at: null, coins_awarded: null, referred: { username: 'friend', display_name: null, avatar_url: null, membership_tier: null, equipped_avatar_border: null, email: 'PRIVATE' } },
        { id: 'r2', status: 'converted', created_at: NOW, converted_at: '2026-10-11T00:00:00.000Z', coins_awarded: 250, referred: { username: 'friend2', display_name: 'Friend Two', avatar_url: null, membership_tier: 'recruit', equipped_avatar_border: null } },
      ],
      coinRows: [{ amount: 250 }, { amount: 250 }],
      milestoneRows: [{ id: 'm1', amount: 250, description: 'First Recruit', created_at: NOW }],
      achievements: [{ slug: 'referral_squad', coin_reward: 500 }],
    })
    const result = await getReferralOverview(admin, OWNER)
    expect(result).toMatchObject({ ok: true, value: { username: 'player 1', totalReferrals: 2, convertedCount: 1, totalCoinsEarned: 500, nextMilestone: { count: 5, bonusCoins: 500 } } })
    if (!result.ok) throw new Error('expected overview')
    expect(result.value.shareUrl).toBe('https://sentinelxesports.com.ng/signup?ref=player%201')
    expect(result.value.invited).toMatchObject([
      { id: 'r1', name: 'friend', status: 'pending', date: NOW, coinsAwarded: null },
      { id: 'r2', name: 'Friend Two', status: 'converted', date: '2026-10-11T00:00:00.000Z', coinsAwarded: 250 },
    ])
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(result.value.milestoneHistory).toEqual([{ id: 'm1', description: 'First Recruit', coins: 250, date: NOW }])
    expect(queries.find((q) => q.table === 'referrals')?.filters).toContainEqual(['referrer_id', OWNER])
    for (const q of queries.filter((q) => q.table === 'sx_coin_transactions')) {
      expect(q.filters).toContainEqual(['player_id', OWNER])
    }
  })

  it('returns an empty panel without a share URL before username claim', async () => {
    const { admin } = fakeAdmin({ username: null })
    expect(await getReferralOverview(admin, OWNER)).toMatchObject({ ok: true, value: { shareUrl: null, totalReferrals: 0, convertedCount: 0, totalCoinsEarned: 0, nextMilestone: { count: 1 } } })
  })

  it('reports failed reads instead of pretending no referrals exist', async () => {
    const { admin } = fakeAdmin({ failTable: 'referrals' })
    expect(await getReferralOverview(admin, OWNER)).toEqual({ ok: false, reason: 'load_failed' })
  })

  it('reports a missing profile', async () => {
    const { admin } = fakeAdmin({ profileMissing: true })
    expect(await getReferralOverview(admin, OWNER)).toEqual({ ok: false, reason: 'not_found' })
  })

  it.each([
    [0, 1], [1, 5], [5, 10], [10, 25], [25, 50], [50, null],
  ])('chooses the next milestone after %i conversions', async (converted, next) => {
    const referrals = Array.from({ length: converted }, (_, index) => ({
      id: `r${index}`, status: 'converted', created_at: NOW, converted_at: NOW,
      coins_awarded: 250, referred: null,
    }))
    const { admin } = fakeAdmin({ referrals })
    const result = await getReferralOverview(admin, OWNER)
    expect(result).toMatchObject({ ok: true, value: { convertedCount: converted, nextMilestone: next === null ? null : { count: next } } })
  })
})
