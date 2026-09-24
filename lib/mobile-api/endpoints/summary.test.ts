import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { buildMeSummary } = vi.hoisted(() => ({ buildMeSummary: vi.fn() }))
vi.mock('@/lib/dashboard/summary-service', () => ({ buildMeSummary }))

import { summaryEndpoint } from './summary'

function getReq() {
  return new Request('https://x.test/api/mobile/v1/me/summary')
}

describe('summaryEndpoint', () => {
  it('calls buildMeSummary with the caller and returns its result', async () => {
    const summary = { nextMatch: null, nextLobby: null, hasSubmittableMatch: false, registrations: [], banners: [] }
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    buildMeSummary.mockResolvedValue(summary)
    const res = await summaryEndpoint.handler(getReq(), { params: {} })
    expect(buildMeSummary).toHaveBeenCalledWith('sb', 'u1')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(summary)
  })

  it('accepts a populated nextLobby in the response', async () => {
    const summary = {
      nextMatch: null,
      nextLobby: { lobbyId: 'l1', tournamentTitle: 'Cup', stageName: 'Stage 1', roundNo: 1, label: 'Round 1', scheduledAt: null, hasRoomCode: true, submitted: false },
      hasSubmittableMatch: false, registrations: [], banners: [],
    }
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    buildMeSummary.mockResolvedValue(summary)
    const res = await summaryEndpoint.handler(getReq(), { params: {} })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(summary)
  })
})
