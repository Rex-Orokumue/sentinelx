'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { QuestStatus } from './quest-status'
import { claimBattleReady, ClaimError, getQuests } from './service'

// Thin web wrappers over lib/guide/service.ts, which the mobile /guide endpoints share.

export async function getQuestStatus(): Promise<
  { ok: true; status: QuestStatus; alreadyClaimed: boolean } | { ok: false; error: string }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  const [quest] = await getQuests(createAdminClient(), user.id)
  const [profile, tournament, match] = quest.steps
  const status: QuestStatus = {
    profileComplete: profile.done,
    firstTournamentEntered: tournament.done,
    firstMatchCompleted: match.done,
    allComplete: quest.allComplete,
  }
  return { ok: true, status, alreadyClaimed: quest.claimed }
}

export async function claimBattleReadyBadge(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please log in.' }

  try {
    // The service re-verifies the quest server-side; a stale tab can never claim early.
    await claimBattleReady(createAdminClient(), user.id)
    return { ok: true }
  } catch (e) {
    if (e instanceof ClaimError) {
      if (e.code === 'quest_incomplete') return { ok: false, error: 'Complete all 3 quest steps first.' }
      if (e.code === 'claim_in_progress') return { ok: false, error: 'Your reward is being processed. Try again in a minute.' }
      return { ok: false, error: 'Reward unavailable right now.' }
    }
    return { ok: false, error: 'Could not claim your reward. Please try again.' }
  }
}
