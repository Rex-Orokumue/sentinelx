import { describe, it, expect, vi } from 'vitest'
import { performReportPost, performReportComment } from './report-service'

function makeSupabase(opts: { postFound?: boolean; commentRow?: { id: string; post_id: string } | null; insertError?: { code: string } | null }) {
  const insert = vi.fn(() => Promise.resolve({ error: opts.insertError ?? null }))
  const postMaybeSingle = vi.fn(() => Promise.resolve({ data: opts.postFound === false ? null : { id: 'p1' } }))
  const commentMaybeSingle = vi.fn(() => Promise.resolve({ data: opts.commentRow ?? null }))
  const from = vi.fn((table: string) => {
    if (table === 'community_content_reports') return { insert }
    if (table === 'community_posts') return { select: () => ({ eq: () => ({ maybeSingle: postMaybeSingle }) }) }
    if (table === 'post_comments') return { select: () => ({ eq: () => ({ maybeSingle: commentMaybeSingle }) }) }
    throw new Error(`unexpected table ${table}`)
  })
  return { from, insert } as unknown as never
}

describe('performReportPost', () => {
  it('inserts a report for an existing post', async () => {
    const supabase = makeSupabase({ postFound: true })
    const result = await performReportPost(supabase, 'u1', 'p1', { reasonCode: 'spam' })
    expect(result).toEqual({ ok: true })
    expect((supabase as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith({
      reporter_id: 'u1', post_id: 'p1', comment_id: null, reason_code: 'spam', reason_note: null,
    })
  })

  it('404s when the post does not exist', async () => {
    const supabase = makeSupabase({ postFound: false })
    const result = await performReportPost(supabase, 'u1', 'p1', { reasonCode: 'spam' })
    expect(result).toEqual({ ok: false, errorCode: 'not_found' })
  })

  it('maps a unique-violation (23505) to already_reported', async () => {
    const supabase = makeSupabase({ postFound: true, insertError: { code: '23505' } })
    const result = await performReportPost(supabase, 'u1', 'p1', { reasonCode: 'spam' })
    expect(result).toEqual({ ok: false, errorCode: 'already_reported' })
  })

  it('maps any other insert error to report_failed, not a false not_found', async () => {
    const supabase = makeSupabase({ postFound: true, insertError: { code: '23503' } })
    const result = await performReportPost(supabase, 'u1', 'p1', { reasonCode: 'spam' })
    expect(result).toEqual({ ok: false, errorCode: 'report_failed' })
  })
})

describe('performReportComment', () => {
  it('resolves post_id server-side from the comment, never trusting the client', async () => {
    const supabase = makeSupabase({ commentRow: { id: 'c1', post_id: 'p1' } })
    const result = await performReportComment(supabase, 'u1', 'c1', { reasonCode: 'harassment', note: 'rude' })
    expect(result).toEqual({ ok: true })
    expect((supabase as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith({
      reporter_id: 'u1', post_id: 'p1', comment_id: 'c1', reason_code: 'harassment', reason_note: 'rude',
    })
  })

  it('404s when the comment does not exist', async () => {
    const supabase = makeSupabase({ commentRow: null })
    const result = await performReportComment(supabase, 'u1', 'c1', { reasonCode: 'spam' })
    expect(result).toEqual({ ok: false, errorCode: 'not_found' })
  })

  it('maps a unique-violation to already_reported', async () => {
    const supabase = makeSupabase({ commentRow: { id: 'c1', post_id: 'p1' }, insertError: { code: '23505' } })
    const result = await performReportComment(supabase, 'u1', 'c1', { reasonCode: 'spam' })
    expect(result).toEqual({ ok: false, errorCode: 'already_reported' })
  })
})
