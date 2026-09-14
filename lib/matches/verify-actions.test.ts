import { describe, it, expect, vi } from 'vitest'
import { advanceKnockout, completeTournamentIfFinal, creditThirdPlacePrize, recomputeGroupAndMaybeAdvance, recomputeGroupStats } from './verify-actions'

vi.mock('@/lib/wallet/service', () => ({ creditWallet: vi.fn() }))
vi.mock('./season-points', () => ({ awardSeasonPoints: vi.fn() }))
vi.mock('@/lib/wagers/settle', () => ({ settleMatchWagers: vi.fn(), refundMatchWagers: vi.fn() }))
vi.mock('@/lib/scoring/apply', () => ({ syncMatchEvents: vi.fn() }))
vi.mock('@/lib/notifications/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn() }))
vi.mock('@/lib/notifications/fixture-created', () => ({ notifyNewFixtures: vi.fn() }))
vi.mock('@/lib/admin/staff', () => ({ notifyStaff: vi.fn() }))
vi.mock('@/lib/community/feed-hooks', () => ({ onMatchConfirmed: vi.fn() }))
vi.mock('./economy-hooks', () => ({ awardMatchEconomy: vi.fn() }))
vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

// Tournament row's update().eq().neq().select() chain, used by
// completeTournamentIfFinal's atomic "claim completion" UPDATE. `completed`
// tracks state across calls so a second call in the same test simulates the
// real WHERE status != 'completed' clause matching nothing the second time.
function fakeAdminForComplete(opts: {
  prizePool: number
  prizeSecond: number | null
  prizeThird: number | null
  alreadyCompleted?: boolean
}) {
  let completed = opts.alreadyCompleted ?? false
  return {
    from(table: string) {
      if (table !== 'tournaments') throw new Error(`unexpected table ${table}`)
      return {
        update: () => ({
          eq: () => ({
            neq: () => ({
              select: async () => {
                if (completed) return { data: [] }
                completed = true
                return {
                  data: [{ id: 't1', prize_pool: opts.prizePool, prize_second: opts.prizeSecond, prize_third: opts.prizeThird }],
                }
              },
            }),
          }),
        }),
      }
    },
  }
}

// Tournament row's update().eq().eq().select() chain, used by
// creditThirdPlacePrize's atomic third_place_prize_credited claim.
function fakeAdminForThirdPlace(opts: { prizeThird: number | null; alreadyCredited?: boolean }) {
  let credited = opts.alreadyCredited ?? false
  return {
    from(table: string) {
      if (table !== 'tournaments') throw new Error(`unexpected table ${table}`)
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => {
                if (credited) return { data: [] }
                credited = true
                return { data: [{ id: 't1', prize_third: opts.prizeThird }] }
              },
            }),
          }),
        }),
      }
    },
  }
}

const decisiveFinal = { status: 'completed' as const, score_a: 3, score_b: 1, player_a_id: 'winner', player_b_id: 'loser' }

describe('completeTournamentIfFinal — prize split', () => {
  it('credits the full prize_pool to the winner when no split is configured (unchanged behavior)', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForComplete({ prizePool: 50000, prizeSecond: null, prizeThird: null })
    await completeTournamentIfFinal(admin as never, 't1', 'final', decisiveFinal)
    expect(creditWallet).toHaveBeenCalledWith(admin, 'winner', 50000, 'prize', 't1')
    expect(creditWallet).toHaveBeenCalledTimes(1)
  })

  it('credits prize_pool - prize_second - prize_third to the winner and prize_second to the loser when a split is configured', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForComplete({ prizePool: 15000, prizeSecond: 4000, prizeThird: 3000 })
    await completeTournamentIfFinal(admin as never, 't1', 'final', decisiveFinal)
    expect(creditWallet).toHaveBeenCalledWith(admin, 'winner', 8000, 'prize', 't1')
    expect(creditWallet).toHaveBeenCalledWith(admin, 'loser', 4000, 'prize', 't1')
    expect(creditWallet).toHaveBeenCalledTimes(2)
  })

  it('is a no-op (already completed) on a second call', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForComplete({ prizePool: 50000, prizeSecond: null, prizeThird: null, alreadyCompleted: true })
    await completeTournamentIfFinal(admin as never, 't1', 'final', decisiveFinal)
    expect(creditWallet).not.toHaveBeenCalled()
  })

  it('is a no-op for a non-final round', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForComplete({ prizePool: 50000, prizeSecond: null, prizeThird: null })
    await completeTournamentIfFinal(admin as never, 't1', 'semi_final', decisiveFinal)
    expect(creditWallet).not.toHaveBeenCalled()
  })
})

// Covers recomputeGroupAndMaybeAdvance's round_robin branch specifically —
// the group_knockout branch it falls back to for every other format is
// exercised only via live/manual QA today (this codebase's Supabase-backed
// admin/match actions are not otherwise unit-tested), same as
// bracket-admin-actions.ts's generate(). This one new branch is worth its
// own mock given it auto-completes a tournament and fires the one-time
// season-points award exactly once.
function fakeAdminForRoundRobinAdvance(opts: { format: string; remaining: number; alreadyCompleted?: boolean }) {
  let completed = opts.alreadyCompleted ?? false
  return {
    from(table: string) {
      if (table === 'tournaments') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: opts.format } }) }) }),
          update: () => ({
            eq: () => ({
              neq: () => ({
                select: async () => {
                  if (completed) return { data: [] }
                  completed = true
                  return { data: [{ id: 't1' }] }
                },
              }),
            }),
          }),
        }
      }
      if (table === 'group_memberships') {
        // Empty group -> computeGroupStats([], []) returns [] -> recomputeGroupStats
        // issues zero update() calls, so this table only ever needs to answer select().
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      if (table === 'matches') {
        return {
          select: (_cols: unknown, countOpts?: unknown) => {
            // The remaining-incomplete-matches count check: .select('*',{count,head}).eq('tournament_id',_).neq('status','completed')
            if (countOpts) {
              return { eq: () => ({ neq: async () => ({ count: opts.remaining }) }) }
            }
            // recomputeGroupStats' group-scoped query: .select('cols').eq('group_id',_).eq('status','completed')
            return { eq: () => ({ eq: async () => ({ data: [] }) }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('recomputeGroupAndMaybeAdvance — round_robin', () => {
  it('does not complete the tournament while matches remain', async () => {
    const { awardSeasonPoints } = await import('./season-points')
    vi.mocked(awardSeasonPoints).mockClear()
    const admin = fakeAdminForRoundRobinAdvance({ format: 'round_robin', remaining: 2 })
    await recomputeGroupAndMaybeAdvance(admin as never, 't1', 'g1')
    expect(awardSeasonPoints).not.toHaveBeenCalled()
  })

  it('completes the tournament and awards season points exactly once when the last match confirms', async () => {
    const { awardSeasonPoints } = await import('./season-points')
    vi.mocked(awardSeasonPoints).mockClear()
    const admin = fakeAdminForRoundRobinAdvance({ format: 'round_robin', remaining: 0 })
    await recomputeGroupAndMaybeAdvance(admin as never, 't1', 'g1')
    expect(awardSeasonPoints).toHaveBeenCalledWith(admin, 't1')
    expect(awardSeasonPoints).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — a second call after completion does not re-award points', async () => {
    const { awardSeasonPoints } = await import('./season-points')
    vi.mocked(awardSeasonPoints).mockClear()
    const admin = fakeAdminForRoundRobinAdvance({ format: 'round_robin', remaining: 0, alreadyCompleted: true })
    await recomputeGroupAndMaybeAdvance(admin as never, 't1', 'g1')
    expect(awardSeasonPoints).not.toHaveBeenCalled()
  })
})

// Group-knockout advance path with manual_knockout_pairing ON: recomputeGroupStats
// runs (empty group), then the gate must stop before any groups/advancer query.
function fakeAdminForManualPairingGroup() {
  return {
    from(table: string) {
      if (table === 'group_memberships')
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { format: 'group_knockout', manual_knockout_pairing: true },
              }),
            }),
          }),
        }
      if (table === 'matches')
        return {
          select: (_c: unknown, opts?: unknown) =>
            opts
              ? { eq: () => ({ neq: async () => ({ count: 0 }) }) }
              : { eq: () => ({ eq: async () => ({ data: [] }) }) },
        }
      if (table === 'groups') throw new Error('must not reach advancer collection when flag is on')
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('recomputeGroupAndMaybeAdvance — manual_knockout_pairing', () => {
  it('does not generate the first knockout round when the flag is on', async () => {
    const { notifyNewFixtures } = await import('@/lib/notifications/fixture-created')
    vi.mocked(notifyNewFixtures).mockClear()
    const admin = fakeAdminForManualPairingGroup()
    await expect(recomputeGroupAndMaybeAdvance(admin as never, 't1', 'g1')).resolves.toBeUndefined()
    expect(notifyNewFixtures).not.toHaveBeenCalled()
  })
})

function fakeAdminForAdvanceKnockoutFlag(flag: boolean) {
  return {
    from(table: string) {
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { manual_knockout_pairing: flag } }) }),
          }),
        }
      if (table === 'matches') {
        if (flag) throw new Error('must not query matches when the flag is on')
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('advanceKnockout — manual_knockout_pairing', () => {
  it('returns early without touching matches when the flag is on', async () => {
    const admin = fakeAdminForAdvanceKnockoutFlag(true)
    await expect(advanceKnockout(admin as never, 't1', 'quarter_final')).resolves.toBeUndefined()
  })
})

describe('creditThirdPlacePrize', () => {
  it('credits prize_third to the given player exactly once', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForThirdPlace({ prizeThird: 3000 })
    await creditThirdPlacePrize(admin as never, 't1', 'bronze-winner')
    expect(creditWallet).toHaveBeenCalledWith(admin, 'bronze-winner', 3000, 'prize', 't1')
    expect(creditWallet).toHaveBeenCalledTimes(1)
  })

  it('is a no-op on a second call (already credited)', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForThirdPlace({ prizeThird: 3000, alreadyCredited: true })
    await creditThirdPlacePrize(admin as never, 't1', 'bronze-winner')
    expect(creditWallet).not.toHaveBeenCalled()
  })

  it('is a no-op when prize_third is not set', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForThirdPlace({ prizeThird: null })
    await creditThirdPlacePrize(admin as never, 't1', 'bronze-winner')
    expect(creditWallet).not.toHaveBeenCalled()
  })
})

function fakeAdminForTeamGroupStats(opts: {
  memberships: { player_id: string | null; team_id: string | null }[]
  matches: { player_a_id: string | null; player_b_id: string | null; team_a_id: string | null; team_b_id: string | null; score_a: number | null; score_b: number | null }[]
}) {
  const updates: { teamId?: string; playerId?: string; data: Record<string, unknown> }[] = []
  return {
    admin: {
      from(table: string) {
        if (table === 'group_memberships') {
          return {
            select: () => ({ eq: async () => ({ data: opts.memberships }) }),
            update: (data: Record<string, unknown>) => ({
              eq: () => ({
                eq: async (col: string, val: string) => {
                  updates.push({ [col === 'team_id' ? 'teamId' : 'playerId']: val, data })
                  return { data: null, error: null }
                },
              }),
            }),
          }
        }
        if (table === 'matches') {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: opts.matches }) }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    updates,
  }
}

describe('recomputeGroupStats — team groups', () => {
  it('credits wins/points to the winning squad, keyed by team_id not player_id', async () => {
    const { admin, updates } = fakeAdminForTeamGroupStats({
      memberships: [
        { player_id: null, team_id: 'sqA' },
        { player_id: null, team_id: 'sqB' },
      ],
      matches: [
        { player_a_id: null, player_b_id: null, team_a_id: 'sqA', team_b_id: 'sqB', score_a: 4, score_b: 2 },
      ],
    })
    await recomputeGroupStats(admin as never, 'g1')
    const sqAUpdate = updates.find((u) => u.teamId === 'sqA')
    expect(sqAUpdate?.data).toMatchObject({ wins: 1, points: 3, goals_for: 4, goals_against: 2 })
    expect(updates.every((u) => u.playerId === undefined)).toBe(true)
  })
})

function fakeAdminForTeamAdvance() {
  const inserted: Record<string, unknown>[] = []
  return {
    admin: {
      from(table: string) {
        if (table === 'tournaments') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { manual_knockout_pairing: false } }) }) }) }
        }
        if (table === 'matches') {
          return {
            select: (_c: unknown, opts?: unknown) => {
              if (opts) return { eq: () => ({ eq: async () => ({ count: 0 }) }) } // "existing next-round" count check
              return {
                eq: () => ({
                  eq: async () => ({
                    data: [
                      { status: 'completed', score_a: 3, score_b: 1, player_a_id: null, player_b_id: null, team_a_id: 'sqA', team_b_id: 'sqB' },
                      { status: 'completed', score_a: 0, score_b: 2, player_a_id: null, player_b_id: null, team_a_id: 'sqC', team_b_id: 'sqD' },
                    ],
                  }),
                }),
              }
            },
            insert: (rows: Record<string, unknown>[]) => {
              inserted.push(...rows)
              return { select: async () => ({ data: [] }) }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
    inserted,
  }
}

describe('advanceKnockout — team rounds', () => {
  it('pairs advancing squads into team_a_id/team_b_id, not player_a_id/player_b_id', async () => {
    const { admin, inserted } = fakeAdminForTeamAdvance()
    await advanceKnockout(admin as never, 't1', 'quarter_final')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ team_a_id: 'sqA', team_b_id: 'sqD' })
    expect(inserted[0].player_a_id).toBeUndefined()
  })
})

function fakeAdminForTeamComplete(opts: { prizePool: number; prizeSecond: number | null; roster: Record<string, string[]> }) {
  let completed = false
  return {
    from(table: string) {
      if (table === 'tournaments') {
        return {
          update: () => ({
            eq: () => ({
              neq: () => ({
                select: async () => {
                  if (completed) return { data: [] }
                  completed = true
                  return { data: [{ id: 't1', prize_pool: opts.prizePool, prize_second: opts.prizeSecond, prize_third: null }] }
                },
              }),
            }),
          }),
        }
      }
      if (table === 'squad_members') {
        return {
          select: () => ({
            eq: async (_col: string, squadId: string) => ({ data: (opts.roster[squadId] ?? []).map((player_id) => ({ player_id })) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const teamFinal = { status: 'completed' as const, score_a: 3, score_b: 1, player_a_id: null, player_b_id: null, team_a_id: 'sqWin', team_b_id: 'sqLose' }

describe('completeTournamentIfFinal — team prize split', () => {
  it('splits the full prize_pool evenly across the winning roster', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForTeamComplete({ prizePool: 4000, prizeSecond: null, roster: { sqWin: ['p1', 'p2', 'p3', 'p4'] } })
    await completeTournamentIfFinal(admin as never, 't1', 'final', teamFinal)
    expect(creditWallet).toHaveBeenCalledTimes(4)
    expect(creditWallet).toHaveBeenCalledWith(admin, 'p1', 1000, 'prize', 't1')
  })

  it('splits prize_second across the losing roster when configured', async () => {
    const { creditWallet } = await import('@/lib/wallet/service')
    vi.mocked(creditWallet).mockClear()
    const admin = fakeAdminForTeamComplete({
      prizePool: 6000,
      prizeSecond: 2000,
      roster: { sqWin: ['p1', 'p2'], sqLose: ['p3', 'p4'] },
    })
    await completeTournamentIfFinal(admin as never, 't1', 'final', teamFinal)
    expect(creditWallet).toHaveBeenCalledWith(admin, 'p1', 2000, 'prize', 't1')
    expect(creditWallet).toHaveBeenCalledWith(admin, 'p3', 1000, 'prize', 't1')
    expect(creditWallet).toHaveBeenCalledTimes(4)
  })
})
