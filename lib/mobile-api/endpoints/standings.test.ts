import { describe, it, expect, vi } from 'vitest'

vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
const { stageStanding } = vi.hoisted(() => ({ stageStanding: vi.fn() }))
vi.mock('@/lib/tournaments/stage-standing', () => ({ stageStanding }))
const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { standingsEndpoint } from './standings'

describe('standingsEndpoint', () => {
  it('requires a stage query param', async () => {
    const res = await standingsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/standings'), { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
  })

  it('404s when the stage does not belong to this tournament', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }
    createAdminClient.mockReturnValue(admin)
    const res = await standingsEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/standings?stage=s1'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(404)
  })

  it('calls stageStanding for a valid stage', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1', advance_count: 8 } }) }) }) }) }) }
    createAdminClient.mockReturnValue(admin)
    const row = {
      entrantId: 'e1', displayName: 'Ada', played: 3, totalPoints: 30, totalKills: 5,
      bestPlacement: 1, lastRoundPlacement: 2, rank: 1, advancing: true, unresolvedTieWith: [],
    }
    stageStanding.mockResolvedValue([row])
    const res = await standingsEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/standings?stage=s1'),
      { params: { id: 't1' } },
    )
    expect(stageStanding).toHaveBeenCalledWith(admin, { id: 's1', advance_count: 8 })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ rows: [row] })
  })
})
