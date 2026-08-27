import { describe, it, expect, vi } from 'vitest'
import { completeTournamentIfFinal, creditThirdPlacePrize } from './verify-actions'

vi.mock('@/lib/wallet/service', () => ({ creditWallet: vi.fn() }))
vi.mock('./season-points', () => ({ awardSeasonPoints: vi.fn() }))
vi.mock('@/lib/wagers/settle', () => ({ settleMatchWagers: vi.fn(), refundMatchWagers: vi.fn() }))
vi.mock('@/lib/scoring/apply', () => ({ syncMatchEvents: vi.fn() }))
vi.mock('@/lib/notifications/notify', () => ({ notify: vi.fn() }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp: vi.fn() }))
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer: vi.fn() }))
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
