import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/coins/service', () => ({ spendCoins: vi.fn() }))
import { spendCoins } from '@/lib/coins/service'
import { payCoinStake } from './coin-stake'

beforeEach(() => vi.mocked(spendCoins).mockReset())

describe('payCoinStake', () => {
  it('takes the stake with one strict spend labelled with the match', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: true, balance: 400 })
    const admin = {} as never
    expect(await payCoinStake(admin, { playerId: 'u1', matchId: 'fm1', stake: 100 })).toEqual({ ok: true })
    expect(spendCoins).toHaveBeenCalledWith(admin, 'u1', 100, 'friendly_stake', 'fm1', 'Friendly stake — match fm1')
  })

  it('reports insufficient when the strict spend is refused', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: false, reason: 'insufficient' })
    expect(await payCoinStake({} as never, { playerId: 'u1', matchId: 'fm1', stake: 100 })).toEqual({ ok: false, reason: 'insufficient' })
  })

  it('reports unavailable, never insufficient, when the coin service fails', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: false, reason: 'unavailable' })
    expect(await payCoinStake({} as never, { playerId: 'u1', matchId: 'fm1', stake: 100 })).toEqual({ ok: false, reason: 'unavailable' })
  })
})
