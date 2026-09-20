'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { awardSeasonPoints } from '@/lib/matches/season-points'
import { revalidateAll } from '@/lib/matches/revalidate'
import { canCloseWithoutWinner, finalSideIds, type FinalMatchRow } from './no-winner'

export type CloseNoWinnerState = { error?: string; success?: boolean } | undefined

// Ends a tournament whose grand final is stuck in 'disputed' with no champion.
//
// What it does:  completes the tournament; runs every OTHER player's placement
//                rewards exactly as a resolved final would; writes an audit
//                note onto the final.
// What it never does:  credit any prize (winner or runner-up), write a score /
//                winner / 'completed' status onto the final, or reward the two
//                finalists. The final stays 'disputed' — that is also how the
//                public pages and confirmResult recognise the state
//                (see isClosedWithoutWinner in no-winner.ts).
//
// Admin-only: deciding that a prize pool goes unpaid is a financial call.
export async function closeTournamentWithoutWinner(
  _prev: CloseNoWinnerState,
  formData: FormData,
): Promise<CloseNoWinnerState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!id) return { error: 'Missing tournament.' }
  if (!reason) return { error: 'Enter a reason for closing without a winner.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status, slug').eq('id', id).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }

  const { data: finals } = await admin
    .from('matches')
    .select('id, round, status, score_a, score_b, player_a_id, player_b_id, team_a_id, team_b_id, admin_note')
    .eq('tournament_id', id)
    .eq('round', 'final')
  const check = canCloseWithoutWinner(t.status, (finals ?? []) as FinalMatchRow[])
  if (!check.ok) return { error: check.reason }
  const final = check.final

  // Atomic claim, same idiom as completeTournamentIfFinal: if two admins click
  // at once, exactly one gets a row back and only that one awards rewards.
  const { data: claimed } = await admin
    .from('tournaments')
    .update({ status: 'completed' })
    .eq('id', id)
    .eq('status', 'active')
    .select('id')
  if (!claimed || claimed.length === 0) return { error: 'This tournament was already closed.' }

  // Keep the original dispute note; append the closure reason after it.
  const note = [final.admin_note, `Closed without a winner: ${reason}`].filter(Boolean).join(' — ')
  await admin.from('matches').update({ admin_note: note }).eq('id', final.id)

  await awardSeasonPoints(admin, id, { excludeEntityIds: finalSideIds(final) })

  revalidateAll(id, t.slug, final.id)
  revalidatePath('/admin/tournaments')
  return { success: true }
}
