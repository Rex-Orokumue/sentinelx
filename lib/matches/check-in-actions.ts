'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canCheckIn } from './check-in'

export type CheckInState = { error?: string; success?: boolean } | undefined

// A player marks themselves present for a match. Records presence only — it
// never resolves the match. The admin still decides every outcome; this just
// gives them evidence that one player turned up and the other didn't, which
// nothing in the system could previously distinguish from a mutual no-show.
export async function checkInToMatch(_prev: CheckInState, formData: FormData): Promise<CheckInState> {
  const matchId = String(formData.get('matchId') ?? '')
  if (!matchId) return { error: 'Missing match.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to check in.' }

  // Re-read server-side; never trust the client for participation or state.
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }

  const isParticipant = user.id === match.player_a_id || user.id === match.player_b_id
  // Mirrors lib/dashboard/fixtures.ts's matchDayReached — an unscheduled match
  // has nothing to compare against yet.
  const dayReached =
    match.scheduled_at != null && new Date(match.scheduled_at).getTime() <= Date.now()

  const { data: existing } = await supabase
    .from('match_check_ins')
    .select('id')
    .eq('match_id', matchId)
    .eq('player_id', user.id)
    .maybeSingle()

  if (!canCheckIn({ isParticipant, dayReached, status: match.status, alreadyCheckedIn: !!existing })) {
    if (!isParticipant) return { error: "You're not playing in this match." }
    if (existing) return { success: true } // already checked in — benign
    if (!dayReached) return { error: "You can check in once it's match day." }
    return { error: 'This match is no longer open for check-in.' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('match_check_ins')
    .insert({ match_id: matchId, player_id: user.id })
  // 23505 = the UNIQUE(match_id, player_id) guard caught a double submit.
  if (error && (error as { code?: string }).code !== '23505') {
    return { error: 'Could not check you in. Please try again.' }
  }

  revalidatePath(`/matches/${matchId}`)
  revalidatePath(`/admin/matches/${matchId}/review`)
  return { success: true }
}
