import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { getQuests, claimBattleReady } = vi.hoisted(() => ({ getQuests: vi.fn(), claimBattleReady: vi.fn() }))
vi.mock('@/lib/guide/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/guide/service')>('@/lib/guide/service')
  return { ...actual, getQuests, claimBattleReady }
})

import { getGuideQuestsEndpoint, claimGuideBadgeEndpoint } from './guide'
import { ClaimError } from '@/lib/guide/service'

const claim = (body: unknown = { quest: 'battle_ready' }) =>
  claimGuideBadgeEndpoint.handler(new Request('https://x.test/api/mobile/v1/guide/badge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const quest = { id: 'battle_ready', steps: [{ key: 'profile_complete', done: true, target: 'edit_profile' }], doneCount: 1, totalCount: 3, allComplete: false, claimed: false, reward: { xp: 100, coins: 50 } }

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
  getQuests.mockReset().mockResolvedValue([quest])
  claimBattleReady.mockReset().mockResolvedValue({ claimed: true, alreadyClaimed: false, xp: 100, coins: 50 })
})

describe('GET /guide/quests', () => {
  it('returns { quests } from the service for ctx.userId only', async () => {
    const res = await getGuideQuestsEndpoint.handler(new Request('https://x.test/api/mobile/v1/guide/quests'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ quests: [quest] })
    expect(getQuests).toHaveBeenCalledWith('admin', 'u1')
  })
})

describe('POST /guide/badge', () => {
  it('returns the claim result', async () => {
    const res = await claim()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ claimed: true, alreadyClaimed: false, xp: 100, coins: 50 })
    expect(claimBattleReady).toHaveBeenCalledWith('admin', 'u1')
  })
  it('maps quest_incomplete to 409', async () => {
    claimBattleReady.mockRejectedValue(new ClaimError('quest_incomplete'))
    const res = await claim()
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('quest_incomplete')
  })
  it('maps claim_in_progress to 409 and reward_unavailable to 503', async () => {
    claimBattleReady.mockRejectedValueOnce(new ClaimError('claim_in_progress'))
    const a = await claim()
    expect(a.status).toBe(409)
    expect((await a.json()).error.code).toBe('claim_in_progress')
    claimBattleReady.mockRejectedValueOnce(new ClaimError('reward_unavailable'))
    const b = await claim()
    expect(b.status).toBe(503)
    expect((await b.json()).error.code).toBe('reward_unavailable')
  })
  it('an unexpected failure is a 500 internal, not a leaked message', async () => {
    claimBattleReady.mockRejectedValue(new Error('db password in message'))
    const res = await claim()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db password')
  })
  it('the body must be { quest: "battle_ready" } or 400 validation_failed', async () => {
    for (const body of [{}, { quest: 'other' }, 'battle_ready']) {
      const res = await claim(body)
      expect(res.status).toBe(400)
    }
    expect(claimBattleReady).not.toHaveBeenCalled()
  })
})
