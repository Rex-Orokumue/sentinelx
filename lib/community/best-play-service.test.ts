import { describe, it, expect, vi } from 'vitest'

const { isVotingWindowOpen } = vi.hoisted(() => ({ isVotingWindowOpen: vi.fn(() => true) }))
vi.mock('./best-play-query', () => ({ isVotingWindowOpen }))
vi.mock('./challenges', () => ({ currentWeekStart: () => '2026-09-28' }))

import { performVoteBestPlay } from './best-play-service'

function makeSupabase(opts: { nominationFound?: boolean; insertError?: { code: string } | null; existingVoteNominationId?: string | null }) {
  const nominationMaybeSingle = vi.fn(() => Promise.resolve({ data: opts.nominationFound === false ? null : { id: 'n1' } }))
  const insert = vi.fn(() => Promise.resolve({ error: opts.insertError ?? null }))
  const voteMaybeSingle = vi.fn(() => Promise.resolve({ data: opts.existingVoteNominationId ? { nomination_id: opts.existingVoteNominationId } : null }))
  const from = vi.fn((table: string) => {
    if (table === 'best_play_nominations') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: nominationMaybeSingle }) }) }) }
    }
    if (table === 'best_play_votes') {
      return {
        insert,
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: voteMaybeSingle }) }) }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as unknown as never
}

describe('performVoteBestPlay', () => {
  it('votes successfully', async () => {
    const supabase = makeSupabase({})
    const result = await performVoteBestPlay(supabase, 'u1', 'n1')
    expect(result).toEqual({ ok: true })
  })

  it('404s when the nomination does not exist this week', async () => {
    const supabase = makeSupabase({ nominationFound: false })
    const result = await performVoteBestPlay(supabase, 'u1', 'n1')
    expect(result).toEqual({ ok: false, errorCode: 'not_found' })
  })

  it('rejects when voting is closed', async () => {
    isVotingWindowOpen.mockReturnValueOnce(false)
    const supabase = makeSupabase({})
    const result = await performVoteBestPlay(supabase, 'u1', 'n1')
    expect(result).toEqual({ ok: false, errorCode: 'voting_closed' })
  })

  it('replays success on a retry of the SAME nomination (unique violation, same nomination already recorded)', async () => {
    const supabase = makeSupabase({ insertError: { code: '23505' }, existingVoteNominationId: 'n1' })
    const result = await performVoteBestPlay(supabase, 'u1', 'n1')
    expect(result).toEqual({ ok: true })
  })

  it('rejects a genuine second vote for a DIFFERENT nomination the same week', async () => {
    const supabase = makeSupabase({ insertError: { code: '23505' }, existingVoteNominationId: 'other-nomination' })
    const result = await performVoteBestPlay(supabase, 'u1', 'n1')
    expect(result).toEqual({ ok: false, errorCode: 'already_voted' })
  })
})
