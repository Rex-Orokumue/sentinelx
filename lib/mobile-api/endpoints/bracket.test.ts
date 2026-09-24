import { describe, it, expect, vi } from 'vitest'

const { optionalAuth } = vi.hoisted(() => ({ optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth }))
const { loadBracketView } = vi.hoisted(() => ({ loadBracketView: vi.fn() }))
vi.mock('@/lib/tournaments/bracket-view', () => ({ loadBracketView }))

import { bracketEndpoint } from './bracket'

const view = {
  standings: [{ groupId: 'g1', groupName: 'Group A', rows: [] }],
  fixtures: { live: [], upcoming: [], completed: [], disputedOrCancelled: [] },
  rounds: [],
  projected: [{ round: 'final', label: 'Final', matchCount: 1 }],
  champion: null,
  thirdPlace: null,
  thirdPlaceMatch: null,
  hasGroups: true,
  hasKnockout: true,
}

describe('bracketEndpoint', () => {
  it('404s when the tournament does not exist', async () => {
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
    optionalAuth.mockResolvedValue({ userClient: supabase, userId: null })
    const res = await bracketEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/bracket'), { params: { id: 't1' } })
    expect(res.status).toBe(404)
  })

  it('loads the tournament format then calls loadBracketView', async () => {
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: 'groups_knockout' } }) }) }) }) }
    optionalAuth.mockResolvedValue({ userClient: supabase, userId: null })
    loadBracketView.mockResolvedValue(view)
    const res = await bracketEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/bracket'), { params: { id: 't1' } })
    expect(loadBracketView).toHaveBeenCalledWith(supabase, 't1', 'groups_knockout')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(view)
  })
})
