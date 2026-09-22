import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn().mockResolvedValue(null) }))
import { performJoinWaitlist } from './waitlist-service'

beforeEach(async () => {
  vi.clearAllMocks()
  const { assertNotPendingDeletion } = await import('@/lib/settings/restriction')
  vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
})

const baseInput = { displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC Test', ignTag: null, agreedToRules: true }

function fakeSupabase(opts: { profile?: { username: string | null }; tournament?: Record<string, unknown> | null; existing?: { id: string; status: string } | null }) {
  return {
    from: (table: string) => {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? { username: 'ada' } }) }) }) }
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament === undefined ? { id: 't1', slug: 'cup', status: 'registration_closed', rules: 'Be nice' } : opts.tournament }) }) }) }
      if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

function fakeAdmin(opts: { insertError?: boolean } = {}) {
  return { from: () => ({ insert: async () => ({ error: opts.insertError ? { message: 'boom' } : null }) }) } as never
}

describe('performJoinWaitlist', () => {
  it('needs_username without a claimed username', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ profile: { username: null } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'needs_username' })
  })
  it('tournament_not_found for an unknown tournament', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ tournament: null }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'tournament_not_found' })
  })
  it('waitlist_not_open while status is still registration_open', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ tournament: { id: 't1', slug: 'cup', status: 'registration_open', rules: null } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'waitlist_not_open' })
  })
  it('rules_agreement_required when rules exist and agreedToRules is false', async () => {
    expect(await performJoinWaitlist(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, agreedToRules: false })).toEqual({ ok: false, errorCode: 'rules_agreement_required' })
  })
  it('already_on_waitlist when an existing waitlisted row exists', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ existing: { id: 'r1', status: 'waitlisted' } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'already_on_waitlist' })
  })
  it('already_registered when an existing non-waitlisted row exists', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ existing: { id: 'r1', status: 'active' } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'already_registered' })
  })
  it('succeeds and inserts a waitlisted row', async () => {
    expect(await performJoinWaitlist(fakeSupabase({}), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: true, tournamentSlug: 'cup' })
  })
  it('waitlist_failed when the insert errors', async () => {
    expect(await performJoinWaitlist(fakeSupabase({}), fakeAdmin({ insertError: true }), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'waitlist_failed' })
  })
})
