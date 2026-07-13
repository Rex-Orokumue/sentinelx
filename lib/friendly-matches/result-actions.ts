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
  const screenshotUrl = String(formData.get('screenshotUrl') ?? '')
  if (!id) return { error: 'Missing match.' }
  if (!screenshotUrl) return { error: 'A screenshot is required.' }

  const parsed = friendlyResultSchema.safeParse({
    scoreChallenger: formData.get('scoreChallenger'),
    scoreOpponent: formData.get('scoreOpponent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (parsed.data.scoreChallenger === parsed.data.scoreOpponent) {
    return { error: 'A friendly match cannot end in a draw.' }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this match can submit a result.' }
  }
  if (fm.status !== 'active') return { error: 'This match is not active.' }

  const winnerId =
    parsed.data.scoreChallenger > parsed.data.scoreOpponent ? fm.challenger_id : fm.opponent_id

  const { error } = await supabase
    .from('friendly_matches')
    .update({
      score_challenger: parsed.data.scoreChallenger,
      score_opponent: parsed.data.scoreOpponent,
      screenshot_url: screenshotUrl,
      winner_id: winnerId,
      status: 'awaiting_admin_confirmation',
    })
    .eq('id', id)
  if (error) return { error: 'Could not submit your result. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true }
}
