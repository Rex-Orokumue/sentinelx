'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performCheckIn, type CheckInErrorCode } from './check-in-service'

export type CheckInState = { error?: string; success?: boolean } | undefined

const CHECK_IN_MESSAGE: Record<CheckInErrorCode, string> = {
  match_not_found: 'Match not found.',
  not_participant: "You're not playing in this match.",
  not_match_day: "You can check in once it's match day.",
  check_in_closed: 'This match is no longer open for check-in.',
  check_in_failed: 'Could not check you in. Please try again.',
}

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

  const result = await performCheckIn(supabase, createAdminClient(), user.id, matchId)
  if (!result.ok) return { error: CHECK_IN_MESSAGE[result.errorCode] }

  revalidatePath(`/matches/${matchId}`)
  revalidatePath(`/admin/matches/${matchId}/review`)
  return { success: true }
}
