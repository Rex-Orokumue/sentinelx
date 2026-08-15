'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { currentWeekStart } from './challenges'

export type VoteState = { error?: string } | undefined

// One vote per player per week (best_play_votes UNIQUE(player_id, week_start))
// — spec §9 "Players tap 'Vote 🔥' — one vote per player."
export async function castBestPlayVote(_prev: VoteState, formData: FormData): Promise<VoteState> {
  const nominationId = String(formData.get('nominationId') ?? '')
  if (!nominationId) return { error: 'Missing nomination.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to vote.' }

  const { error } = await supabase
    .from('best_play_votes')
    .insert({ nomination_id: nominationId, player_id: user.id, week_start: currentWeekStart() })
  if (error) {
    if (error.code === '23505') return { error: "You've already voted this week." }
    return { error: 'Could not save your vote.' }
  }

  revalidatePath('/community')
  return undefined
}
