import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { canCheckIn } from './check-in'
import { isMatchParticipant } from './participant'

type Admin = ReturnType<typeof createAdminClient>

export type CheckInErrorCode = 'match_not_found' | 'not_participant' | 'not_match_day' | 'check_in_closed' | 'check_in_failed'
export type CheckInResult = { ok: true } | { ok: false; errorCode: CheckInErrorCode }

export async function performCheckIn(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  matchId: string,
): Promise<CheckInResult> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }

  const isParticipant = await isMatchParticipant(supabase, userId, match)
  const dayReached = match.scheduled_at != null && new Date(match.scheduled_at).getTime() <= Date.now()

  const { data: existing } = await supabase
    .from('match_check_ins')
    .select('id')
    .eq('match_id', matchId)
    .eq('player_id', userId)
    .maybeSingle()

  if (!canCheckIn({ isParticipant, dayReached, status: match.status, alreadyCheckedIn: !!existing })) {
    if (!isParticipant) return { ok: false, errorCode: 'not_participant' }
    if (existing) return { ok: true }
    if (!dayReached) return { ok: false, errorCode: 'not_match_day' }
    return { ok: false, errorCode: 'check_in_closed' }
  }

  const { error } = await admin.from('match_check_ins').insert({ match_id: matchId, player_id: userId })
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, errorCode: 'check_in_failed' }

  return { ok: true }
}
