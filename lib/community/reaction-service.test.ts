import { describe, it, expect, vi, beforeEach } from 'vitest'

const { incrementChallenge } = vi.hoisted(() => ({ incrementChallenge: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./challenges', () => ({ incrementChallenge }))
const { notifyBoth } = vi.hoisted(() => ({ notifyBoth: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth }))

import { performSetReaction, performRemoveReaction } from './reaction-service'

function makeSupabase(opts: { postFound?: boolean; existing?: { id: string; reaction: string } | null }) {
  const postMaybeSingle = vi.fn(() => Promise.resolve({ data: opts.postFound === false ? null : { id: 'p1' } }))
  const existingMaybeSingle = vi.fn(() => Promise.resolve({ data: opts.existing ?? null }))
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) }))
  const insert = vi.fn().mockResolvedValue({})
  const del = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({}) })) }))
  const from = vi.fn((table: string) => {
    if (table === 'community_posts') return { select: () => ({ eq: () => ({ maybeSingle: postMaybeSingle }) }) }
    if (table === 'post_reactions') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }) }),
        update,
        insert,
        delete: del,
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from, update, insert, del } as unknown as { from: unknown; update: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> }
}

// notifyNewReaction's own admin.from('community_posts') lookup — returning
// no row short-circuits it before any further admin queries, which is all
// these tests need (they assert on incrementChallenge/insert, not on the
// notification fan-out itself).
const adminMock = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) })) }

describe('performSetReaction', () => {
  beforeEach(() => {
    incrementChallenge.mockClear()
    notifyBoth.mockClear()
  })

  it('404s when the post is missing', async () => {
    const supabase = makeSupabase({ postFound: false })
    const result = await performSetReaction(supabase as never, adminMock as never, 'u1', 'p1', 'fire')
    expect(result).toEqual({ ok: false, errorCode: 'not_found' })
  })

  it('is a no-op when replaying the same reaction (set-idempotent)', async () => {
    const supabase = makeSupabase({ existing: { id: 'r1', reaction: 'fire' } })
    const result = await performSetReaction(supabase as never, adminMock as never, 'u1', 'p1', 'fire')
    expect(result).toEqual({ ok: true, reaction: 'fire' })
    expect(supabase.update).not.toHaveBeenCalled()
    expect(supabase.insert).not.toHaveBeenCalled()
    expect(incrementChallenge).not.toHaveBeenCalled()
  })

  it('switches an existing reaction without a challenge/notify fan-out', async () => {
    const supabase = makeSupabase({ existing: { id: 'r1', reaction: 'wow' } })
    const result = await performSetReaction(supabase as never, adminMock as never, 'u1', 'p1', 'fire')
    expect(result).toEqual({ ok: true, reaction: 'fire' })
    expect(supabase.update).toHaveBeenCalled()
    expect(incrementChallenge).not.toHaveBeenCalled()
  })

  it('a brand-new reaction inserts and counts toward the weekly challenge', async () => {
    const supabase = makeSupabase({ existing: null })
    const result = await performSetReaction(supabase as never, adminMock as never, 'u1', 'p1', 'fire')
    expect(result).toEqual({ ok: true, reaction: 'fire' })
    expect(supabase.insert).toHaveBeenCalledWith({ post_id: 'p1', player_id: 'u1', reaction: 'fire' })
    expect(incrementChallenge).toHaveBeenCalledWith(adminMock, 'u1', 'reactions_given')
  })
})

describe('performRemoveReaction', () => {
  it('always succeeds (naturally idempotent)', async () => {
    const supabase = makeSupabase({})
    const result = await performRemoveReaction(supabase as never, 'u1', 'p1')
    expect(result).toEqual({ ok: true })
    expect(supabase.del).toHaveBeenCalled()
  })
})
