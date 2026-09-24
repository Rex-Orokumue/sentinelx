import { describe, it, expect } from 'vitest'
import { buildMatchCentre } from './centre-service'

function fakeSupabase(opts: {
  match?: Record<string, unknown> | null
  checkIns?: { player_id: string }[]
  wagers?: { pick_player_id: string; stake_coins: number; bettor_id: string }[]
  submissionCount?: number
}) {
  return {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'match_check_ins') return { select: () => ({ eq: () => Promise.resolve({ data: opts.checkIns ?? [] }) }) }
      if (table === 'match_wagers') return { select: () => ({ eq: () => Promise.resolve({ data: opts.wagers ?? [] }) }) }
      if (table === 'match_results') return { select: (_c: string, meta?: { count?: string; head?: boolean }) => (meta?.count ? { eq: () => Promise.resolve({ count: opts.submissionCount ?? 0 }) } : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

const scheduledMatch = {
  id: 'm1', status: 'scheduled', scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), is_full_day: false,
  player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null, noshow_flagged_at: null,
}

describe('buildMatchCentre', () => {
  it('returns null when the match does not exist', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: null }), 'm1', 'p1')
    expect(result).toBeNull()
  })

  it('reports the caller as a participant and check-in availability', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: scheduledMatch }), 'm1', 'p1')
    expect(result?.isParticipant).toBe(true)
    expect(result?.canCheckIn).toBe(false)
  })

  it('reports a logged-out visitor as a non-participant', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: scheduledMatch }), 'm1', null)
    expect(result?.isParticipant).toBe(false)
    expect(result?.canCheckIn).toBe(false)
  })

  it('summarizes the wager pools and reports the window as open when scheduled_at is far enough out', async () => {
    const result = await buildMatchCentre(
      fakeSupabase({ match: scheduledMatch, wagers: [{ pick_player_id: 'p1', stake_coins: 100, bettor_id: 'x1' }, { pick_player_id: 'p2', stake_coins: 50, bettor_id: 'x2' }] }),
      'm1', 'p3',
    )
    expect(result?.wager.pools).toEqual({ playerA: 100, playerB: 50 })
    expect(result?.wager.windowOpen).toBe(true)
  })

  it('reports noShowEligible false when nothing has been flagged', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: scheduledMatch }), 'm1', 'p1')
    expect(result?.noShowEligible).toBe(false)
  })
})
