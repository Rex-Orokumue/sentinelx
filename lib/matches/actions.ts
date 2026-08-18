'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitResultSchema } from './schema'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'

export type SubmitResultState = { error?: string; success?: boolean } | undefined

export async function submitMatchResult(
  _prev: SubmitResultState,
  formData: FormData,
): Promise<SubmitResultState> {
  const matchId = String(formData.get('matchId') ?? '')
  const screenshotPath = String(formData.get('screenshotPath') ?? '')
  if (!matchId) return { error: 'Missing match.' }

  const parsed = submitResultSchema.safeParse({
    scoreA: formData.get('scoreA'),
    scoreB: formData.get('scoreB'),
    recordingUrl: formData.get('recordingUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to submit a result.' }

  const { data: match } = await supabase
    .from('matches')
    .select('id, player_a_id, player_b_id, status')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { error: 'Match not found.' }
  if (match.status === 'bye') return { error: 'This is a bye — there is no result to submit.' }
  if (user.id !== match.player_a_id && user.id !== match.player_b_id) {
    return { error: 'Only the players in this match can submit a result.' }
  }
  if (match.status === 'cancelled') return { error: 'This match was cancelled.' }
  if (match.status === 'completed') return { error: 'This match result is already confirmed.' }

  const { data: existing } = await supabase
    .from('match_results')
    .select('id, status, screenshot_url')
    .eq('match_id', matchId)
    .eq('submitted_by', user.id)
    .maybeSingle()

  if (existing && existing.status !== 'pending') {
    return { error: 'Your submission is under review and can no longer be edited.' }
  }

  const { count: priorSubmissionCount } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)

  const finalScreenshot = screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { error: 'A screenshot is required.' }

  const recordingUrl =
    parsed.data.recordingUrl && parsed.data.recordingUrl !== '' ? parsed.data.recordingUrl : null

  const { error } = await supabase.from('match_results').upsert(
    {
      match_id: matchId,
      submitted_by: user.id,
      score_a: parsed.data.scoreA,
      score_b: parsed.data.scoreB,
      screenshot_url: finalScreenshot,
      recording_url: recordingUrl,
      status: 'pending',
    },
    { onConflict: 'match_id,submitted_by' },
  )
  if (error) return { error: 'Could not submit your result. Please try again.' }

  if (!priorSubmissionCount) {
    const admin = createAdminClient()
    type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
    type ReviewMatchRow = { player_a: NameRef; player_b: NameRef; tournament: { title: string } | { title: string }[] | null }
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
        return r?.display_name ?? r?.username ?? 'Player'
      }
      const tRef = Array.isArray(md.tournament) ? md.tournament[0] : md.tournament
      const notification = resultNotification({
        type: 'result_needs_review',
        tournamentTitle: tRef?.title ?? 'Tournament',
        playerAName: nameOf(md.player_a as NameRef),
        playerBName: nameOf(md.player_b as NameRef),
        createdAt: new Date().toISOString(),
      })
      void notifyStaff(admin, 'result_needs_review', { title: notification.title, body: notification.body, link: notification.link })
    }
  }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
