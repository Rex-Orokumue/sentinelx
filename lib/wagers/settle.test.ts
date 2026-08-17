import { describe, it, expect, vi } from 'vitest'
import { computeWagerPayouts } from './settle'

describe('computeWagerPayouts', () => {
  it('splits the fee-adjusted losing pool pro-rata among winners, and takes the 5% platform fee', () => {
    // Spec §5 worked example: 3 bettors x100 on methio (winner), 1 bettor x200 on Arole.
    const wagers = [
      { id: 'w1', bettorId: 'p1', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'w2', bettorId: 'p2', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'w3', bettorId: 'p3', pickPlayerId: 'methio', stakeCoins: 100 },
      { id: 'l1', bettorId: 'p4', pickPlayerId: 'arole', stakeCoins: 200 },
    ]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(10) // 5% of 200
    // distributable 190, each of 3 winners: 100 + floor(190 * 100/300) = 100 + 63 = 163
    expect(payouts.get('w1')).toBe(163)
    expect(payouts.get('w2')).toBe(163)
    expect(payouts.get('w3')).toBe(163)
    expect(payouts.get('l1')).toBe(0)
  })

  it('takes no fee and pays nothing when nobody backed the winner', () => {
    const wagers = [{ id: 'l1', bettorId: 'p1', pickPlayerId: 'arole', stakeCoins: 200 }]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(0)
    expect(payouts.get('l1')).toBe(0)
  })

  it('returns stake-back with no fee when nobody backed the loser', () => {
    const wagers = [{ id: 'w1', bettorId: 'p1', pickPlayerId: 'methio', stakeCoins: 500 }]
    const { payouts, platformFee } = computeWagerPayouts(wagers, 'methio')
    expect(platformFee).toBe(0)
    expect(payouts.get('w1')).toBe(500)
  })
})

describe('settleMatchWagers notifications', () => {
  it('notifies both a winning and a losing bettor with different messages', async () => {
    vi.resetModules()
    const notifyInApp = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@/lib/notifications/inbox', () => ({ notifyInApp }))
    const pushToPlayer = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@/lib/notifications/push', () => ({ pushToPlayer }))
    vi.doMock('@/lib/coins/service', () => ({ recordCoinTransaction: vi.fn().mockResolvedValue(undefined) }))

    const rows = [
      { id: 'w1', bettor_id: 'winner-1', pick_player_id: 'player-A', stake_coins: 100 },
      { id: 'w2', bettor_id: 'loser-1', pick_player_id: 'player-B', stake_coins: 50 },
    ]
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'match_wagers') {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: rows }) })) })),
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          }
        }
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }),
    } as unknown as Parameters<typeof import('./settle').settleMatchWagers>[0]

    const { settleMatchWagers } = await import('./settle')
    await settleMatchWagers(admin, 'match-1', 'player-A')

    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'winner-1', type: 'wager_settled' }))
    expect(notifyInApp).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'loser-1', type: 'wager_settled' }))
    expect(pushToPlayer).toHaveBeenCalledWith('winner-1', 'wager_settled', expect.anything(), expect.anything())
    expect(pushToPlayer).toHaveBeenCalledWith('loser-1', 'wager_settled', expect.anything(), expect.anything())
  })
})
