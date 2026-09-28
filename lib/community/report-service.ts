import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

export type ReasonCode = 'spam' | 'harassment' | 'hate_speech' | 'nudity_or_sexual_content' | 'violence' | 'misinformation' | 'other'
export type ReportErrorCode = 'not_found' | 'already_reported' | 'report_failed'
export type ReportResult = { ok: true } | { ok: false; errorCode: ReportErrorCode }

export async function performReportPost(
  supabase: Client,
  userId: string,
  postId: string,
  input: { reasonCode: ReasonCode; note?: string },
): Promise<ReportResult> {
  const { data: post } = await supabase.from('community_posts').select('id').eq('id', postId).maybeSingle()
  if (!post) return { ok: false, errorCode: 'not_found' }

  const { error } = await supabase
    .from('community_content_reports')
    .insert({ reporter_id: userId, post_id: postId, comment_id: null, reason_code: input.reasonCode, reason_note: input.note ?? null })
  if (error) {
    if (error.code === '23505') return { ok: false, errorCode: 'already_reported' }
    console.error('[performReportPost] community_content_reports insert failed', { postId, reporterId: userId, code: error.code, message: error.message })
    return { ok: false, errorCode: 'report_failed' }
  }
  return { ok: true }
}

export async function performReportComment(
  supabase: Client,
  userId: string,
  commentId: string,
  input: { reasonCode: ReasonCode; note?: string },
): Promise<ReportResult> {
  // post_id is resolved server-side from the comment — never trusted from
  // the client — so a staff reviewer always sees the real parent post.
  const { data: comment } = await supabase.from('post_comments').select('id, post_id').eq('id', commentId).maybeSingle()
  if (!comment) return { ok: false, errorCode: 'not_found' }

  const { error } = await supabase
    .from('community_content_reports')
    .insert({ reporter_id: userId, post_id: comment.post_id, comment_id: commentId, reason_code: input.reasonCode, reason_note: input.note ?? null })
  if (error) {
    if (error.code === '23505') return { ok: false, errorCode: 'already_reported' }
    console.error('[performReportComment] community_content_reports insert failed', { commentId, reporterId: userId, code: error.code, message: error.message })
    return { ok: false, errorCode: 'report_failed' }
  }
  return { ok: true }
}
