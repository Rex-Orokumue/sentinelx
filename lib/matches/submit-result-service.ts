import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { submitResultSchema } from './schema'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
import { opponentSubmissionNotice } from './submission-notice'
import { isMatchParticipant } from './participant'
import { notifyBoth } from '@/lib/notifications/send'

type Admin = ReturnType<typeof createAdminClient>

export type SubmitResultErrorCode =
  | 'match_not_found' | 'bye_no_result' | 'not_participant' | 'match_cancelled' | 'already_confirmed'
  | 'submission_locked' | 'screenshot_required' | 'validation_failed' | 'submit_failed'
export type SubmitResultResult = { ok: true } | { ok: false; errorCode: SubmitResultErrorCode }

type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
type ReviewMatchRow = { player_a: NameRef; player_b: NameRef; tournament: { title: string } | { title: string }[] | null }

export async function performSubmitMatchResult(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  matchId: string,
  input: { scoreA: number; scoreB: number; recordingUrl: string; screenshotPath: string },
): Promise<SubmitResultResult> {
  const parsed = submitResultSchema.safeParse({ scoreA: input.scoreA, scoreB: input.scoreB, recordingUrl: input.recordingUrl })
  if (!parsed.success) return { ok: false, errorCode: 'validation_failed' }

  const { data: match } = await supabase
    .from('matches')
    .select('id, player_a_id, player_b_id, team_a_id, team_b_id, status')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }
  if (match.status === 'bye') return { ok: false, errorCode: 'bye_no_result' }
  if (!(await isMatchParticipant(supabase, userId, match))) return { ok: false, errorCode: 'not_participant' }
  if (match.status === 'cancelled') return { ok: false, errorCode: 'match_cancelled' }
  if (match.status === 'completed') return { ok: false, errorCode: 'already_confirmed' }

  const { data: existing } = await supabase
    .from('match_results')
    .select('id, status, screenshot_url')
    .eq('match_id', matchId)
    .eq('submitted_by', userId)
    .maybeSingle()
  if (existing && existing.status !== 'pending') return { ok: false, errorCode: 'submission_locked' }

  const { count: priorSubmissionCount } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)

  const finalScreenshot = input.screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { ok: false, errorCode: 'screenshot_required' }

  const recordingUrl = parsed.data.recordingUrl && parsed.data.recordingUrl !== '' ? parsed.data.recordingUrl : null

  const { error } = await admin.from('match_results').upsert(
    {
      match_id: matchId, submitted_by: userId, score_a: parsed.data.scoreA, score_b: parsed.data.scoreB,
      screenshot_url: finalScreenshot, recording_url: recordingUrl, status: 'pending',
    },
    { onConflict: 'match_id,submitted_by' },
  )
  if (error) return { ok: false, errorCode: 'submit_failed' }

  const { data: mdRaw } = await admin
    .from('matches')
    .select(
      'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('id', matchId)
    .maybeSingle()
  const md = (mdRaw ?? null) as unknown as ReviewMatchRow | null
  if (md) {
    const nameOf = (x: NameRef) => {
      const r = Array.isArray(x) ? x[0] ?? null : x
      return r?.display_name ?? r?.username ?? null
    }
    const tRef = Array.isArray(md.tournament) ? md.tournament[0] : md.tournament
    const tournamentTitle = tRef?.title ?? 'Tournament'
    const playerAName = nameOf(md.player_a as NameRef)
    const playerBName = nameOf(md.player_b as NameRef)

    if (!priorSubmissionCount) {
      const notification = resultNotification({
        type: 'result_needs_review', tournamentTitle,
        playerAName: playerAName ?? 'Player', playerBName: playerBName ?? 'Player', createdAt: new Date().toISOString(),
      })
      await notifyStaff(admin, 'result_needs_review', { title: notification.title, body: notification.body, link: notification.link })
    }

    const notice = opponentSubmissionNotice({
      matchId, submitterId: userId, playerAId: match.player_a_id, playerBId: match.player_b_id,
      playerAName, playerBName, tournamentTitle, scoreA: parsed.data.scoreA, scoreB: parsed.data.scoreB,
      isResubmission: Boolean(existing),
    })
    if (notice) await notifyBoth(notice.recipientId, notice.notification, 'result_submitted', { link: notice.link })
  }

  return { ok: true }
}
