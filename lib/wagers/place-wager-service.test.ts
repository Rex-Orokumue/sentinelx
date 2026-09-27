import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn() }))
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'
import { performPlaceWager } from './place-wager-service'

beforeEach(() => {
  vi.mocked(getCoinBalance).mockReset()
  vi.mocked(recordCoinTransaction).mockReset()
  vi.mocked(assertNotPendingDeletion).mockReset()
})

function fakeAdmin(opts: { match?: Record<string, unknown> | null; existing?: { id: string; stake_coins: number } | null; upsertError?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const admin = {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'match_wagers') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }), upsert }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, upsert }
}

const openMatch = { id: 'm1', status: 'scheduled', scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), player_a_id: 'p1', player_b_id: 'p2', is_full_day: false }

describe('performPlaceWager', () => {
  it('reports pending_deletion when the account is restricted', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue('Your account is pending deletion.')
    const { admin } = fakeAdmin()
    const result = await performPlaceWager({} as never, admin, 'u1', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'pending_deletion' })
  })

  it('reports match_not_found', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: null })
    const result = await performPlaceWager({} as never, admin, 'u1', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports own_match when the caller is one of the two players', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'p1', 'm1', { pickPlayerId: 'p2', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'own_match' })
  })

  it('reports invalid_pick when pickPlayerId is neither player', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'someone-else', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'invalid_pick' })
  })

  it('reports window_closed once wagering has closed', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: { ...openMatch, scheduled_at: new Date(Date.now() - 3_600_000).toISOString() } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'window_closed' })
  })

  it('reports insufficient_coins', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(50)
    const { admin } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'insufficient_coins' })
  })

  it('places a fresh wager, debiting the full stake once', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(200)
    const { admin, upsert } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: true })
    expect(recordCoinTransaction).toHaveBeenCalledTimes(1)
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'u3', -100, 'wager_stake', 'm1', 'Wager — match m1')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ match_id: 'm1', bettor_id: 'u3', pick_player_id: 'p1', stake_coins: 100, status: 'pending', payout_coins: null }),
      { onConflict: 'match_id,bettor_id' },
    )
  })

  it('refunds the previous stake before charging the new one when changing an existing wager', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    // Balance excludes the previously-staked 100 (already spent); 50 + 100 (previousStake) = 150, enough for the new 150 stake.
    vi.mocked(getCoinBalance).mockResolvedValue(50)
    const { admin } = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 100 } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 150 })
    expect(result).toEqual({ ok: true })
    expect(recordCoinTransaction).toHaveBeenNthCalledWith(1, admin, 'u3', 100, 'wager_refund', 'm1', 'Wager changed — previous stake refunded')
    expect(recordCoinTransaction).toHaveBeenNthCalledWith(2, admin, 'u3', -150, 'wager_stake', 'm1', 'Wager — match m1')
  })

  it('auto-reverses the debit when the upsert fails', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(200)
    const { admin } = fakeAdmin({ match: openMatch, upsertError: { message: 'db down' } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'wager_failed' })
    expect(recordCoinTransaction).toHaveBeenLastCalledWith(admin, 'u3', 100, 'wager_refund', 'm1', 'Wager save failed — auto-reversed')
  })
})
