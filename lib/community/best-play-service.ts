import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { currentWeekStart } from './challenges'
import { isVotingWindowOpen } from './best-play-query'

type Client = SupabaseClient<Database>

export type VoteBestPlayErrorCode = 'not_found' | 'voting_closed' | 'already_voted'
export type VoteBestPlayResult = { ok: true } | { ok: false; errorCode: VoteBestPlayErrorCode }

// A new service, not a refactor of castBestPlayVote (best-play-actions.ts) —
// the web action currently skips the not_found/voting_closed checks the
// mobile spec (§4) requires; adding a nomination-existence + window check
// here rather than retrofitting the web action avoids changing existing web
// behavior in a phase whose scope is mobile endpoints (logged as a Ruling).
export async function performVoteBestPlay(supabase: Client, userId: string, nominationId: string): Promise<VoteBestPlayResult> {
  const weekStart = currentWeekStart()
  const { data: nomination } = await supabase
    .from('best_play_nominations')
    .select('id')
    .eq('id', nominationId)
    .eq('week_start', weekStart)
    .maybeSingle()
  if (!nomination) return { ok: false, errorCode: 'not_found' }
  if (!isVotingWindowOpen()) return { ok: false, errorCode: 'voting_closed' }

  const { error } = await supabase.from('best_play_votes').insert({ nomination_id: nominationId, player_id: userId, week_start: weekStart })
  if (error) {
    if (error.code === '23505') {
      // Same nomination re-voted (a genuine retry) replays as success; the
      // conflict only means "already voted" when it's for a *different*
      // nomination this week — check which case this is.
      const { data: existing } = await supabase.from('best_play_votes').select('nomination_id').eq('player_id', userId).eq('week_start', weekStart).maybeSingle()
      if (existing?.nomination_id === nominationId) return { ok: true }
      return { ok: false, errorCode: 'already_voted' }
    }
    return { ok: false, errorCode: 'not_found' }
  }
  return { ok: true }
}
