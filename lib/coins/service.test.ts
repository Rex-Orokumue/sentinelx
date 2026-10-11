import { describe, it, expect, vi, afterEach } from 'vitest'
import { recordCoinTransaction, spendCoins, getCoinBalance } from './service'

const fakeAdmin = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as never

afterEach(() => vi.restoreAllMocks())

describe('getCoinBalance', () => {
  it('returns 0 for a player with no wallet row yet', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
    expect(await getCoinBalance(admin as never, 'p1')).toBe(0)
  })
})

describe('recordCoinTransaction', () => {
  it('calls coin_apply in clamp mode and returns the new balance', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 120, error: null })
    expect(await recordCoinTransaction(fakeAdmin(rpc), 'p1', 20, 'match_played', 'm1', 'd')).toBe(120)
    expect(rpc).toHaveBeenCalledWith('coin_apply', {
      p_player: 'p1', p_delta: 20, p_source: 'match_played', p_reference: 'm1', p_description: 'd', p_clamp: true,
    })
  })

  it('passes a negative amount through in clamp mode (admin deduction)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null })
    expect(await recordCoinTransaction(fakeAdmin(rpc), 'p1', -100, 'admin_deduct', null)).toBe(0)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_delta: -100, p_clamp: true })
  })

  it('resolves to null, logs, and never throws when the rpc errors or throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errored = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } })
    const thrown = vi.fn().mockRejectedValue(new Error('network'))
    expect(await recordCoinTransaction(fakeAdmin(errored), 'p1', 20, 'match_played', null)).toBeNull()
    expect(await recordCoinTransaction(fakeAdmin(thrown), 'p1', 20, 'match_played', null)).toBeNull()
  })

  it('maps an undefined description to null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5, error: null })
    await recordCoinTransaction(fakeAdmin(rpc), 'p1', 5, 'daily_login', null)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_description: null, p_reference: null })
  })
})

describe('spendCoins', () => {
  it('calls coin_apply strictly with a negative delta', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 850, error: null })
    expect(await spendCoins(fakeAdmin(rpc), 'p1', 150, 'store_purchase', 'item1', 'Gold Crown')).toEqual({ ok: true, balance: 850 })
    expect(rpc).toHaveBeenCalledWith('coin_apply', {
      p_player: 'p1', p_delta: -150, p_source: 'store_purchase', p_reference: 'item1', p_description: 'Gold Crown', p_clamp: false,
    })
  })

  it('reports insufficient when coin_apply returns null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await spendCoins(fakeAdmin(rpc), 'p1', 150, 'store_purchase', null)).toEqual({ ok: false, reason: 'insufficient' })
  })

  it('reports unavailable, not insufficient, when the rpc errors or throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errored = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } })
    const thrown = vi.fn().mockRejectedValue(new Error('network'))
    expect(await spendCoins(fakeAdmin(errored), 'p1', 150, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await spendCoins(fakeAdmin(thrown), 'p1', 150, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('rejects a non-positive amount without calling the database', async () => {
    const rpc = vi.fn()
    expect(await spendCoins(fakeAdmin(rpc), 'p1', 0, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await spendCoins(fakeAdmin(rpc), 'p1', -5, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
