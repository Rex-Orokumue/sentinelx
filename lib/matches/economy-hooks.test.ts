import { describe, it, expect, vi } from 'vitest'
import { awardMatchEconomy } from './economy-hooks'

vi.mock('@/lib/coins/service', () => ({ recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))
vi.mock('@/lib/achievements/unlock', () => ({ checkAndUnlockAchievements: vi.fn() }))

function fakeAdmin(events: { player_id: string; event_type: string }[], existingCoinTx: { player_id: string; source: string; reference_id: string }[]) {
  return {
    from(table: string) {
      if (table === 'sx_score_events') {
        return { select: () => ({ eq: () => ({ in: async () => ({ data: events }) }) }) }
      }
      if (table === 'sx_coin_transactions') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: (col2: string, val2: string) => ({
                eq: async (col3: string, val3: string) =>
                  ({ data: existingCoinTx.filter((t) => t.player_id === val && t.source === val2 && t.reference_id === val3) }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('awardMatchEconomy', () => {
  it('pays participation + win bonus to the winner, participation only to the loser', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const admin = fakeAdmin(
      [
        { player_id: 'a', event_type: 'match_completed' },
        { player_id: 'b', event_type: 'match_completed' },
        { player_id: 'a', event_type: 'win_no_dispute' },
      ],
      [],
    )
    await awardMatchEconomy(admin as never, 'm1')
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'a', 20, 'match_played', 'm1')
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'a', 30, 'match_won', 'm1')
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'b', 20, 'match_played', 'm1')
    expect(recordCoinTransaction).not.toHaveBeenCalledWith(admin, 'b', 30, 'match_won', 'm1')
    expect(awardXP).toHaveBeenCalledWith(admin, 'a', 50, 'match_played', 'm1')
    expect(awardXP).toHaveBeenCalledWith(admin, 'a', 50, 'match_won', 'm1')
  })

  it('pays nobody for a no-show event', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    vi.mocked(recordCoinTransaction).mockClear()
    const admin = fakeAdmin([{ player_id: 'a', event_type: 'no_show' }], [])
    await awardMatchEconomy(admin as never, 'm1')
    expect(recordCoinTransaction).not.toHaveBeenCalled()
  })

  it('is dedup-safe — does not re-pay a player already paid for this match', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    vi.mocked(recordCoinTransaction).mockClear()
    const admin = fakeAdmin(
      [{ player_id: 'a', event_type: 'match_completed' }],
      [{ player_id: 'a', source: 'match_played', reference_id: 'm1' }],
    )
    await awardMatchEconomy(admin as never, 'm1')
    expect(recordCoinTransaction).not.toHaveBeenCalledWith(admin, 'a', 20, 'match_played', 'm1')
  })
})
