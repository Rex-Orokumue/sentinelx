import { describe, it, expect, vi, afterEach } from 'vitest'
import { creditWallet, debitWallet } from './service'

const fakeAdmin = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as never

afterEach(() => vi.restoreAllMocks())

describe('creditWallet', () => {
  it('calls wallet_apply with a positive delta and the default category', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1500, error: null })
    const res = await creditWallet(fakeAdmin(rpc), 'p1', 500, 'prize', 'ref1', 'note')
    expect(rpc).toHaveBeenCalledWith('wallet_apply', {
      p_player: 'p1', p_delta: 500, p_type: 'prize', p_reference: 'ref1', p_note: 'note', p_category: 'tournament_prize',
    })
    expect(res).toEqual({ ok: true, balance: 1500 })
  })

  it('returns ok:false and logs, never throws, when the rpc errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(creditWallet(fakeAdmin(rpc), 'p1', 500, 'prize', null)).resolves.toEqual({ ok: false })
    expect(spy).toHaveBeenCalled()
  })

  it('returns ok:false and does not throw when the rpc itself throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(creditWallet(fakeAdmin(rpc), 'p1', 500, 'prize', null)).resolves.toEqual({ ok: false })
  })
})

describe('debitWallet', () => {
  it('uses a negative delta and the withdrawal category', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 400, error: null })
    expect(await debitWallet(fakeAdmin(rpc), 'p1', 100, 'withdrawal_request', 'wr1')).toEqual({ ok: true })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_delta: -100, p_category: 'withdrawal' })
  })

  it('maps a null balance to insufficient', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await debitWallet(fakeAdmin(rpc), 'p1', 100, 'withdrawal_request', null)).toEqual({
      ok: false, error: 'Insufficient wallet balance.',
    })
  })

  it('maps an rpc error to unavailable, not an insufficient-balance claim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await debitWallet(fakeAdmin(rpc), 'p1', 100, 'withdrawal_request', null)).toEqual({
      ok: false, error: 'Wallet is unavailable right now.',
    })
  })
})
