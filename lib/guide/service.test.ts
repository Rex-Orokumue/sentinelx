/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory stand-in for the supabase chain */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const awardXP = vi.fn(async (..._a: unknown[]) => ({ newXp: 0, tierChanged: false, newTier: 'recruit' }))
const recordCoinTransaction = vi.fn(async (..._a: unknown[]) => 0)
vi.mock('@/lib/membership/xp', () => ({ awardXP: (...a: unknown[]) => awardXP(...a) }))
vi.mock('@/lib/coins/service', () => ({ recordCoinTransaction: (...a: unknown[]) => recordCoinTransaction(...a) }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn(async () => {}) }))
import { claimBattleReady, getQuests } from './service'

// In-memory stand-in for the tables the service touches. Mirrors PostgREST semantics where it matters:
// duplicate (player_id, achievement_id) insert -> { code: '23505' }; conditional lease update returns the rows it
// changed (or []).
function makeDb(seed: { complete: boolean }) {
  const t = {
    profiles: [{ id: 'u1', username: 'a', avatar_url: seed.complete ? 'x' : null, total_matches: seed.complete ? 1 : 0 }],
    tournament_registrations: seed.complete ? [{ player_id: 'u1', payment_status: 'paid' }] : [],
    achievements: [{ id: 'ach1', slug: 'battle_ready', name: 'Battle Ready', xp_reward: 100, coin_reward: 50 }],
    player_achievements: [] as Array<Record<string, any>>,
    xp_events: [] as Array<Record<string, any>>,
    sx_coin_transactions: [] as Array<Record<string, any>>,
  }
  let nextId = 1
  const from = (name: keyof typeof t) => {
    const rows: Array<Record<string, any>> = t[name] as any
    const filters: Array<(r: any) => boolean> = []
    const addFilters = (b: any) => {
      b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b }
      b.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b }
      // only the lease filter is used: 'reward_lease_until.is.null,reward_lease_until.lt.<iso>'
      b.or = (expr: string) => {
        const lt = expr.split('.lt.')[1]
        filters.push((r) => r.reward_lease_until == null || r.reward_lease_until < lt)
        return b
      }
      return b
    }
    const hit = () => rows.filter((r) => filters.every((f) => f(r)))
    const q: any = addFilters({
      select: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: hit()[0] ?? null, error: null }),
      insert: async (row: Record<string, any>) => {
        if (name === 'player_achievements' && rows.some((r) => r.player_id === row.player_id && r.achievement_id === row.achievement_id)) return { error: { code: '23505' } }
        rows.push({ id: 'pa' + nextId++, unlocked_at: new Date().toISOString(), ...row })
        return { error: null }
      },
      update: (patch: Record<string, any>) => {
        const u: any = addFilters({
          select: async () => { const h = hit(); h.forEach((r) => Object.assign(r, patch)); return { data: h.map((r) => ({ id: r.id })), error: null } },
          then: (res: any) => { hit().forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }).then(res) },
        })
        return u
      },
      then: (res: any) => Promise.resolve({ data: hit(), error: null, count: hit().length }).then(res),
    })
    return q
  }
  return { admin: { from } as never, t }
}
// awardXP/recordCoinTransaction mocks also append to the fake ledger so the existence guards see them:
function wireLedger(t: ReturnType<typeof makeDb>['t']) {
  awardXP.mockImplementation(async (_a: unknown, pid: unknown, _x: unknown, source: unknown, ref: unknown) => { t.xp_events.push({ player_id: pid, source, reference_id: ref }); return { newXp: 0, tierChanged: false, newTier: 'recruit' } })
  recordCoinTransaction.mockImplementation(async (_a: unknown, pid: unknown, _n: unknown, source: unknown, ref: unknown) => { t.sx_coin_transactions.push({ player_id: pid, source, reference_id: ref }); return 0 })
}
beforeEach(() => { awardXP.mockReset(); recordCoinTransaction.mockReset() })

describe('claimBattleReady', () => {
  it('incomplete quest throws quest_incomplete and inserts nothing', async () => {
    const { admin, t } = makeDb({ complete: false })
    await expect(claimBattleReady(admin, 'u1')).rejects.toMatchObject({ code: 'quest_incomplete' })
    expect(t.player_achievements).toHaveLength(0)
  })
  it('happy path grants once and seals the claim', async () => {
    const { admin, t } = makeDb({ complete: true }); wireLedger(t)
    const r = await claimBattleReady(admin, 'u1')
    expect(r).toEqual({ claimed: true, alreadyClaimed: false, xp: 100, coins: 50 })
    expect(awardXP).toHaveBeenCalledTimes(1); expect(recordCoinTransaction).toHaveBeenCalledTimes(1)
    expect(t.player_achievements[0].rewards_granted_at).toBeTruthy()
  })
  it('a second call after success is alreadyClaimed and awards nothing', async () => {
    const { admin, t } = makeDb({ complete: true }); wireLedger(t)
    await claimBattleReady(admin, 'u1'); awardXP.mockClear(); recordCoinTransaction.mockClear()
    expect(await claimBattleReady(admin, 'u1')).toMatchObject({ alreadyClaimed: true })
    expect(awardXP).not.toHaveBeenCalled(); expect(recordCoinTransaction).not.toHaveBeenCalled()
  })
  it('coin failure after XP: the claim stays open; a retry after lease expiry awards ONLY coins', async () => {
    const { admin, t } = makeDb({ complete: true }); wireLedger(t)
    recordCoinTransaction.mockRejectedValueOnce(new Error('db down'))
    let clock = new Date('2026-10-05T10:00:00Z')
    await expect(claimBattleReady(admin, 'u1', () => clock)).rejects.toThrow('db down')
    expect(t.player_achievements[0].rewards_granted_at).toBeNull()
    clock = new Date('2026-10-05T10:03:00Z') // lease (2 min) has expired
    const r = await claimBattleReady(admin, 'u1', () => clock)
    expect(r.alreadyClaimed).toBe(false)
    expect(awardXP).toHaveBeenCalledTimes(1) // not re-awarded
    expect(t.sx_coin_transactions).toHaveLength(1)
    expect(t.player_achievements[0].rewards_granted_at).toBeTruthy()
  })
  it('a retry while the lease is live is claim_in_progress and awards nothing', async () => {
    const { admin, t } = makeDb({ complete: true }); wireLedger(t)
    recordCoinTransaction.mockRejectedValueOnce(new Error('db down'))
    const clock = new Date('2026-10-05T10:00:00Z')
    await expect(claimBattleReady(admin, 'u1', () => clock)).rejects.toThrow()
    awardXP.mockClear()
    await expect(claimBattleReady(admin, 'u1', () => new Date('2026-10-05T10:01:00Z'))).rejects.toMatchObject({ code: 'claim_in_progress' })
    expect(awardXP).not.toHaveBeenCalled()
  })
  it('two concurrent claims award XP exactly once', async () => {
    const { admin, t } = makeDb({ complete: true }); wireLedger(t)
    const results = await Promise.allSettled([claimBattleReady(admin, 'u1'), claimBattleReady(admin, 'u1')])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    expect(awardXP).toHaveBeenCalledTimes(1)
    expect(t.xp_events).toHaveLength(1)
  })
  it('a missing achievement row is reward_unavailable', async () => {
    const { admin, t } = makeDb({ complete: true })
    t.achievements.length = 0
    await expect(claimBattleReady(admin, 'u1')).rejects.toMatchObject({ code: 'reward_unavailable' })
  })
})

describe('getQuests', () => {
  it('claimed only when rewards_granted_at is set; targets are the enum; reward comes from the achievements row', async () => {
    const { admin, t } = makeDb({ complete: true })
    t.player_achievements.push({ id: 'pa0', player_id: 'u1', achievement_id: 'ach1', rewards_granted_at: null })
    let [q] = await getQuests(admin, 'u1')
    expect(q.claimed).toBe(false)
    expect(q.steps.map((s) => s.target)).toEqual(['edit_profile', 'tournaments', 'matches'])
    expect(q.reward).toEqual({ xp: 100, coins: 50 })
    t.player_achievements[0].rewards_granted_at = '2026-10-05T10:00:00Z'
    ;[q] = await getQuests(admin, 'u1')
    expect(q.claimed).toBe(true)
  })
})
