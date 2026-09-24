import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./apply', () => ({ refreshPlayer: vi.fn() }))
import { refreshPlayer } from './apply'
import { submitOpponentRating } from './opponent-rating-service'

beforeEach(() => {
  vi.mocked(refreshPlayer).mockReset()
})

function fakeAdmin(opts: { match?: Record<string, unknown> | null; ratingInsertError?: { code?: string } | null } = {}) {
  const scoreInsert = vi.fn().mockResolvedValue({ error: null })
  const ratingInsert = vi.fn().mockResolvedValue({ error: opts.ratingInsertError ?? null })
  const admin = {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'opponent_ratings') return { insert: ratingInsert }
      if (table === 'sx_score_events') return { insert: scoreInsert }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, scoreInsert, ratingInsert }
}

const completedMatch = { id: 'm1', status: 'completed', player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
const teamMatch = { id: 'm2', status: 'completed', player_a_id: null, player_b_id: null, team_a_id: 'sq1', team_b_id: 'sq2' }

describe('submitOpponentRating', () => {
  it('reports match_not_found', async () => {
    const { admin } = fakeAdmin({ match: null })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports not_a_participant for a non-participant', async () => {
    const { admin } = fakeAdmin({ match: completedMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'stranger', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'not_a_participant' })
  })

  it('reports result_not_confirmed_yet for a match that has not completed', async () => {
    const { admin } = fakeAdmin({ match: { ...completedMatch, status: 'scheduled' } })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'result_not_confirmed_yet' })
  })

  it('reports not_ratable for a team match', async () => {
    const { admin } = fakeAdmin({ match: teamMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm2', raterId: 'anyone', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'not_ratable' })
  })

  it('reports already_rated on a 23505 unique-violation from opponent_ratings', async () => {
    const { admin, ratingInsert } = fakeAdmin({ match: completedMatch, ratingInsertError: { code: '23505' } })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'already_rated' })
    expect(ratingInsert).toHaveBeenCalledWith({ match_id: 'm1', rater_id: 'p1', rated_id: 'p2', stars: 5 })
  })

  it('inserts +20 for a 5-star rating and refreshes the rated player', async () => {
    const { admin, scoreInsert, ratingInsert } = fakeAdmin({ match: completedMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: true })
    expect(ratingInsert).toHaveBeenCalledWith({ match_id: 'm1', rater_id: 'p1', rated_id: 'p2', stars: 5 })
    expect(scoreInsert).toHaveBeenCalledWith({ player_id: 'p2', match_id: 'm1', event_type: 'rating_received', points_delta: 20 })
    expect(refreshPlayer).toHaveBeenCalledWith(admin, 'p2')
  })

  it('inserts +10 for a 4-star rating', async () => {
    const { admin, scoreInsert } = fakeAdmin({ match: completedMatch })
    await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 4 })
    expect(scoreInsert).toHaveBeenCalledWith(expect.objectContaining({ points_delta: 10 }))
  })

  it('inserts -20 for a 1 or 2-star rating', async () => {
    const { admin, scoreInsert } = fakeAdmin({ match: completedMatch })
    await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p2', stars: 1 })
    expect(scoreInsert).toHaveBeenCalledWith({ player_id: 'p1', match_id: 'm1', event_type: 'rating_received', points_delta: -20 })
  })

  it('records a 3-star rating in opponent_ratings with no sx_score_events row and no refresh', async () => {
    const { admin, scoreInsert, ratingInsert } = fakeAdmin({ match: completedMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 3 })
    expect(result).toEqual({ ok: true })
    expect(ratingInsert).toHaveBeenCalledWith({ match_id: 'm1', rater_id: 'p1', rated_id: 'p2', stars: 3 })
    expect(scoreInsert).not.toHaveBeenCalled()
    expect(refreshPlayer).not.toHaveBeenCalled()
  })
})
