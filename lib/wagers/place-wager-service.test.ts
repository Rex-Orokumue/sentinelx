import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn(), spendCoins: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn() }))
import { getCoinBalance, recordCoinTransaction, spendCoins } from '@/lib/coins/service'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'
import { performPlaceWager } from './place-wager-service'

beforeEach(() => {
  vi.mocked(getCoinBalance).mockReset()
  vi.mocked(recordCoinTransaction).mockReset()
  vi.mocked(spendCoins).mockReset()
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

  it('reports insufficient_coins and writes no wager when the strict spend is refused', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(spendCoins).mockResolvedValue({ ok: false, reason: 'insufficient' })
    const { admin, upsert } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'insufficient_coins' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('reports wager_failed, not insufficient_coins, when the coin service is unavailable', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(spendCoins).mockResolvedValue({ ok: false, reason: 'unavailable' })
    const { admin, upsert } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'wager_failed' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('places a fresh wager, spending the full stake once, then saves it', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(spendCoins).mockResolvedValue({ ok: true, balance: 100 })
    const { admin, upsert } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: true })
    expect(spendCoins).toHaveBeenCalledTimes(1)
    expect(spendCoins).toHaveBeenCalledWith(admin, 'u3', 100, 'wager_stake', 'm1', 'Wager — match m1')
    expect(recordCoinTransaction).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ match_id: 'm1', bettor_id: 'u3', pick_player_id: 'p1', stake_coins: 100, status: 'pending', payout_coins: null }),
      { onConflict: 'match_id,bettor_id' },
    )
  })

  it('raising a stake spends only the difference, in one strict spend, with no refund row', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(spendCoins).mockResolvedValue({ ok: true, balance: 50 })
    const { admin } = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 100 } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 150 })
    expect(result).toEqual({ ok: true })
    expect(spendCoins).toHaveBeenCalledTimes(1)
    expect(spendCoins).toHaveBeenCalledWith(admin, 'u3', 50, 'wager_stake', 'm1', 'Wager — match m1')
    expect(recordCoinTransaction).not.toHaveBeenCalled()
  })

  it('lowering a stake saves the wager first and then credits the difference', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin, upsert } = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 150 } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: true })
    expect(spendCoins).not.toHaveBeenCalled()
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'u3', 50, 'wager_refund', 'm1', 'Wager changed — stake reduced')
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(recordCoinTransaction).mock.invocationCallOrder[0])
  })

  it('an unchanged stake moves no coins', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin, upsert } = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 100 } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: true })
    expect(spendCoins).not.toHaveBeenCalled()
    expect(recordCoinTransaction).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('auto-reverses exactly the net spend when the save fails after a fresh or raised stake', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(spendCoins).mockResolvedValue({ ok: true, balance: 50 })
    const fresh = fakeAdmin({ match: openMatch, upsertError: { message: 'db down' } })
    expect(await performPlaceWager({} as never, fresh.admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })).toEqual({ ok: false, errorCode: 'wager_failed' })
    expect(recordCoinTransaction).toHaveBeenLastCalledWith(fresh.admin, 'u3', 100, 'wager_refund', 'm1', 'Wager save failed — auto-reversed')

    const raised = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 100 }, upsertError: { message: 'db down' } })
    expect(await performPlaceWager({} as never, raised.admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 150 })).toEqual({ ok: false, errorCode: 'wager_failed' })
    expect(recordCoinTransaction).toHaveBeenLastCalledWith(raised.admin, 'u3', 50, 'wager_refund', 'm1', 'Wager save failed — auto-reversed')
  })

  it('a failed save on a lowered stake moves no coins at all (the credit never ran)', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 150 }, upsertError: { message: 'db down' } })
    expect(await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })).toEqual({ ok: false, errorCode: 'wager_failed' })
    expect(spendCoins).not.toHaveBeenCalled()
    expect(recordCoinTransaction).not.toHaveBeenCalled()
  })
})
