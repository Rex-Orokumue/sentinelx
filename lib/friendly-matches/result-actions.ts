'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { friendlyResultSchema } from './result-schema'
import type { FriendlyActionState } from './actions'

export async function submitFriendlyResult(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  const screenshotPath = String(formData.get('screenshotPath') ?? '')
  if (!id) return { error: 'Missing match.' }
  if (!screenshotPath) return { error: 'A screenshot is required.' }

  const parsed = friendlyResultSchema.safeParse({
    scoreChallenger: formData.get('scoreChallenger'),
    scoreOpponent: formData.get('scoreOpponent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, status, stake_amount')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this match can submit a result.' }
  }
  if (fm.status !== 'active') return { error: 'This match is not active.' }
  // Only staked friendlies need a winner (to receive the pot) — a free
  // friendly can end in a draw like any casual match.
  if (fm.stake_amount && parsed.data.scoreChallenger === parsed.data.scoreOpponent) {
    return { error: 'A staked friendly match cannot end in a draw.' }
  }

  const { error } = await supabase.from('friendly_match_results').upsert(
    {
      friendly_match_id: id,
      submitted_by: user.id,
      score_challenger: parsed.data.scoreChallenger,
      score_opponent: parsed.data.scoreOpponent,
      screenshot_url: screenshotPath,
    },
    { onConflict: 'friendly_match_id,submitted_by' },
  )
  if (error) return { error: 'Could not submit your result. Please try again.' }

  const { count } = await supabase
    .from('friendly_match_results')
    .select('id', { count: 'exact', head: true })
    .eq('friendly_match_id', id)
  if ((count ?? 0) >= 2) {
    await supabase.from('friendly_matches').update({ status: 'awaiting_admin_confirmation' }).eq('id', id)
  }

  revalidatePath(`/dashboard/friendlies/${id}`)
  return { success: true }
}
