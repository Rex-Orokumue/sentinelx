import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/staff', () => ({ notifyStaff: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn() }))

import { performSubmitMatchResult } from './submit-result-service'

function fakeSupabase(opts: {
  match?: Record<string, unknown> | null
  existing?: { id: string; status: string; screenshot_url: string | null } | null
  priorCount?: number
  matchDetail?: Record<string, unknown> | null
}) {
  return {
    from: (table: string) => {
      if (table === 'matches') {
        return {
          select: (cols: string) =>
            cols.includes('player_a:profiles')
              ? { eq: () => ({ maybeSingle: async () => ({ data: opts.matchDetail ?? null }) }) }
              : { eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) },
        }
      }
      if (table === 'match_results') {
        return {
          select: (_c: string, meta?: { count?: string; head?: boolean }) =>
            meta?.count
              ? { eq: () => Promise.resolve({ count: opts.priorCount ?? 0 }) }
              : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}
function fakeAdmin(opts: { upsertError?: unknown; matchDetail?: Record<string, unknown> | null } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const admin = {
    from: (table: string) => {
      if (table === 'match_results') return { upsert }
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.matchDetail ?? null }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, upsert }
}

const openMatch = { id: 'm1', player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null, status: 'scheduled' }
const input = { scoreA: 3, scoreB: 1, recordingUrl: '', screenshotPath: 'shots/1.png' }

describe('performSubmitMatchResult', () => {
  it('reports match_not_found', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: null }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports bye_no_result for a bye', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: { ...openMatch, status: 'bye' } }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'bye_no_result' })
  })

  it('reports not_participant for a non-participant', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), fakeAdmin().admin, 'stranger', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'not_participant' })
  })

  it('reports match_cancelled', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: { ...openMatch, status: 'cancelled' } }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'match_cancelled' })
  })

  it('reports already_confirmed for a completed match', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: { ...openMatch, status: 'completed' } }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'already_confirmed' })
  })

  it('reports submission_locked when the caller already has a non-pending submission', async () => {
    const result = await performSubmitMatchResult(
      fakeSupabase({ match: openMatch, existing: { id: 'r1', status: 'confirmed', screenshot_url: 'shots/old.png' } }),
      fakeAdmin().admin, 'p1', 'm1', input,
    )
    expect(result).toEqual({ ok: false, errorCode: 'submission_locked' })
  })

  it('reports screenshot_required when no screenshot path is given and none exists yet', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), fakeAdmin().admin, 'p1', 'm1', { ...input, screenshotPath: '' })
    expect(result).toEqual({ ok: false, errorCode: 'screenshot_required' })
  })

  it('reports validation_failed for an out-of-range score', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), fakeAdmin().admin, 'p1', 'm1', { ...input, scoreA: -1 })
    expect(result).toEqual({ ok: false, errorCode: 'validation_failed' })
  })

  it('upserts the result and returns ok on a valid submission with no match-detail row (notifications skipped)', async () => {
    const { admin, upsert } = fakeAdmin()
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch, matchDetail: null }), admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ match_id: 'm1', submitted_by: 'p1', score_a: 3, score_b: 1, screenshot_url: 'shots/1.png', status: 'pending' }),
      { onConflict: 'match_id,submitted_by' },
    )
  })

  it('reports submit_failed when the upsert errors', async () => {
    const { admin } = fakeAdmin({ upsertError: { message: 'db down' } })
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'submit_failed' })
  })
})
