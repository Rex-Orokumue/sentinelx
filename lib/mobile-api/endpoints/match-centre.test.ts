import { describe, it, expect, vi } from 'vitest'

const { optionalAuth } = vi.hoisted(() => ({ optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth }))
const { buildMatchCentre } = vi.hoisted(() => ({ buildMatchCentre: vi.fn() }))
vi.mock('@/lib/matches/centre-service', () => ({ buildMatchCentre }))

import { matchCentreEndpoint } from './match-centre'

describe('matchCentreEndpoint', () => {
  it('404s when the match does not exist', async () => {
    optionalAuth.mockResolvedValue({ userClient: {}, userId: null })
    buildMatchCentre.mockResolvedValue(null)
    const res = await matchCentreEndpoint.handler(new Request('https://x.test/api/mobile/v1/matches/m1/centre'), { params: { id: 'm1' } })
    expect(res.status).toBe(404)
  })

  it('passes the caller userId when logged in, null when a guest, and returns the built view', async () => {
    const view = {
      matchId: 'm1', status: 'scheduled', scheduledAt: null, isFullDay: false,
      isParticipant: true, canCheckIn: false, checkedInPlayerIds: [],
      checkInVerdict: 'none' as const, soleAttendeeId: null,
      wager: { windowOpen: false, pools: { playerA: 0, playerB: 0 }, feeRate: 0.05, minStake: 50, maxStake: 2000, myPickPlayerId: null, myStakeCoins: null, estimatedPayoutIfIStakeA100: 100 },
      noShowEligible: false,
    }
    optionalAuth.mockResolvedValue({ userClient: 'sb', userId: 'u1' })
    buildMatchCentre.mockResolvedValue(view)
    const res = await matchCentreEndpoint.handler(new Request('https://x.test/api/mobile/v1/matches/m1/centre'), { params: { id: 'm1' } })
    expect(buildMatchCentre).toHaveBeenCalledWith('sb', 'm1', 'u1')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(view)
  })
})
