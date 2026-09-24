import type { createAdminClient } from '@/lib/supabase/admin'
import { refreshPlayer } from './apply'

type Admin = ReturnType<typeof createAdminClient>

export type RatingErrorCode =
  | 'match_not_found' | 'not_a_participant' | 'result_not_confirmed_yet' | 'cannot_rate_self' | 'not_ratable' | 'already_rated'
export type RatingResult = { ok: true } | { ok: false; errorCode: RatingErrorCode }

const DELTA_BY_STARS: Record<number, number> = { 5: 20, 4: 10, 3: 0, 2: -20, 1: -20 }

export async function submitOpponentRating(
  admin: Admin,
  input: { matchId: string; raterId: string; stars: 1 | 2 | 3 | 4 | 5 },
): Promise<RatingResult> {
  const { data: match } = await admin
    .from('matches')
    .select('id, status, player_a_id, player_b_id, team_a_id, team_b_id')
    .eq('id', input.matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }
  if (match.player_a_id === null && match.player_b_id === null) return { ok: false, errorCode: 'not_ratable' }
  if (input.raterId !== match.player_a_id && input.raterId !== match.player_b_id) return { ok: false, errorCode: 'not_a_participant' }
  if (match.status !== 'completed') return { ok: false, errorCode: 'result_not_confirmed_yet' }

  const ratedId = input.raterId === match.player_a_id ? match.player_b_id : match.player_a_id
  if (!ratedId) return { ok: false, errorCode: 'not_ratable' } // defensive: should be unreachable given the checks above

  const { error: ratingError } = await admin
    .from('opponent_ratings')
    .insert({ match_id: input.matchId, rater_id: input.raterId, rated_id: ratedId, stars: input.stars })
  if (ratingError) {
    if ((ratingError as { code?: string }).code === '23505') return { ok: false, errorCode: 'already_rated' }
    return { ok: false, errorCode: 'already_rated' } // any other insert failure here is also treated as "can't rate again" rather than a 500 -- the rating itself is non-critical, never block on it
  }

  const delta = DELTA_BY_STARS[input.stars]
  if (delta !== 0) {
    await admin.from('sx_score_events').insert({ player_id: ratedId, match_id: input.matchId, event_type: 'rating_received', points_delta: delta })
    await refreshPlayer(admin, ratedId)
  }

  return { ok: true }
}
