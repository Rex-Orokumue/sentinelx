'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performSubmitMatchResult, type SubmitResultErrorCode } from './submit-result-service'

export type SubmitResultState = { error?: string; success?: boolean } | undefined

const SUBMIT_RESULT_MESSAGE: Record<SubmitResultErrorCode, string> = {
  match_not_found: 'Match not found.',
  bye_no_result: 'This is a bye — there is no result to submit.',
  not_participant: 'Only the players in this match can submit a result.',
  match_cancelled: 'This match was cancelled.',
  already_confirmed: 'This match result is already confirmed.',
  submission_locked: 'Your submission is under review and can no longer be edited.',
  screenshot_required: 'A screenshot is required.',
  validation_failed: 'Please check your score entries.',
  submit_failed: 'Could not submit your result. Please try again.',
}

export async function submitMatchResult(
  _prev: SubmitResultState,
  formData: FormData,
): Promise<SubmitResultState> {
  const matchId = String(formData.get('matchId') ?? '')
  const screenshotPath = String(formData.get('screenshotPath') ?? '')
  if (!matchId) return { error: 'Missing match.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to submit a result.' }

  const result = await performSubmitMatchResult(supabase, createAdminClient(), user.id, matchId, {
    scoreA: Number(formData.get('scoreA')),
    scoreB: Number(formData.get('scoreB')),
    recordingUrl: String(formData.get('recordingUrl') ?? ''),
    screenshotPath,
  })
  if (!result.ok) return { error: SUBMIT_RESULT_MESSAGE[result.errorCode] }

  revalidatePath(`/matches/${matchId}`)
  return { success: true }
}
