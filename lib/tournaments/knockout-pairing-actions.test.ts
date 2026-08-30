import { describe, it, expect, vi } from 'vitest'
import type { BracketMatch } from './bracket'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ userId: 'staff' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/notifications/fixture-created', () => ({ notifyNewFixtures: vi.fn() }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp: vi.fn() }))
vi.mock('@/lib/notifications/push', () => ({ pushToPlayer: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./bracket-view', () => ({ loadBracketView: vi.fn() }))
vi.mock('./round-schedule', () => ({ nextRoundScheduledAt: vi.fn().mockResolvedValue(null) }))

const W1 = '00000000-0000-4000-8000-000000000001'
const W2 = '00000000-0000-4000-8000-000000000002'
const W3 = '00000000-0000-4000-8000-000000000003'
const W4 = '00000000-0000-4000-8000-000000000004'
const L1 = '00000000-0000-4000-8000-0000000000a1'
const L2 = '00000000-0000-4000-8000-0000000000a2'
const L3 = '00000000-0000-4000-8000-0000000000a3'
const L4 = '00000000-0000-4000-8000-0000000000a4'

function bm(over: Partial<BracketMatch>): BracketMatch {
  return {
    id: 'm',
    round: 'quarter_final',
    group_id: null,
    groupName: null,
    status: 'completed',
    score_a: 1,
    score_b: 0,
    scheduled_at: null,
    is_full_day: true,
    playerA: { id: 'a', name: 'A' },
    playerB: { id: 'b', name: 'B' },
    ...over,
  }
}

const RESOLVED_QF: BracketMatch[] = [
  bm({ id: 'q1', playerA: { id: W1, name: 'W1' }, playerB: { id: L1, name: 'L1' }, score_a: 2, score_b: 0 }),
  bm({ id: 'q2', playerA: { id: L2, name: 'L2' }, playerB: { id: W2, name: 'W2' }, score_a: 0, score_b: 1 }),
  bm({ id: 'q3', playerA: { id: W3, name: 'W3' }, playerB: { id: L3, name: 'L3' }, score_a: 3, score_b: 1 }),
  bm({ id: 'q4', playerA: { id: W4, name: 'W4' }, playerB: { id: L4, name: 'L4' }, score_a: 5, score_b: 2 }),
]

function view(rounds: { round: string; label: string; matches: BracketMatch[] }[]) {
  return {
    standings: [],
    rounds,
    fixtures: { live: [], upcoming: [], completed: [], disputedOrCancelled: [] },
    projected: [],
    champion: null,
    thirdPlace: null,
    hasGroups: true,
    hasKnockout: rounds.length > 0,
  }
}

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

function fakeAdmin(opts: {
  onInsert?: (rows: unknown) => void
  roundExistsCount?: number
  updates?: Array<{ id: string; row: Record<string, unknown> }>
  profiles?: Array<{ id: string; username: string | null; display_name: string | null }>
}) {
  return {
    from(table: string) {
      if (table === 'tournaments')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { format: 'group_knockout', slug: 's' } }) }),
          }),
        }
      if (table === 'matches')
        return {
          select: (_c: unknown, countOpts?: unknown) =>
            countOpts
              ? { eq: () => ({ eq: async () => ({ count: opts.roundExistsCount ?? 0 }) }) }
              : { eq: () => ({ eq: async () => ({ data: [] }) }) },
          insert: (rows: unknown) => {
            opts.onInsert?.(rows)
            return {
              select: async () => ({
                data: (rows as unknown[]).map((_, i) => ({
                  id: `new${i}`,
                  player_a_id: 'x',
                  player_b_id: 'y',
                  scheduled_at: null,
                  is_full_day: true,
                })),
                error: null,
              }),
            }
          },
          update: (row: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              opts.updates?.push({ id, row })
              return { error: null }
            },
          }),
        }
      if (table === 'profiles')
        return { select: () => ({ in: async () => ({ data: opts.profiles ?? [] }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('createKnockoutRound', () => {
  it('rejects an assignment that is not a permutation of the true participants', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    vi.mocked(loadBracketView).mockResolvedValue(view([{ round: 'quarter_final', label: 'QF', matches: RESOLVED_QF }]) as never)
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({}) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'semi_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[W1, W1], [W3, W4]] }),
      }),
    )
    expect(r?.error).toBeTruthy()
  })

  it('rejects when the submitted round is not the pending round', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    vi.mocked(loadBracketView).mockResolvedValue(view([{ round: 'quarter_final', label: 'QF', matches: RESOLVED_QF }]) as never)
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({}) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[W1, W2], [W3, W4]] }),
      }),
    )
    expect(r?.error).toBeTruthy()
  })

  it('inserts scheduled rows for a valid assignment and notifies', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    const { notifyNewFixtures } = await import('@/lib/notifications/fixture-created')
    vi.mocked(notifyNewFixtures).mockClear()
    vi.mocked(loadBracketView).mockResolvedValue(view([{ round: 'quarter_final', label: 'QF', matches: RESOLVED_QF }]) as never)
    let inserted: unknown = null
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ onInsert: (r) => (inserted = r) }) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'semi_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[W1, W3], [W2, W4]] }),
      }),
    )
    expect(r?.success).toBe(true)
    expect(Array.isArray(inserted) && (inserted as unknown[]).length).toBe(2)
    expect((inserted as Array<Record<string, unknown>>)[0]).toMatchObject({
      round: 'semi_final',
      status: 'scheduled',
      group_id: null,
    })
    expect(notifyNewFixtures).toHaveBeenCalledTimes(1)
  })

  it('refuses to create a round that already has rows', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    vi.mocked(loadBracketView).mockResolvedValue(view([{ round: 'quarter_final', label: 'QF', matches: RESOLVED_QF }]) as never)
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ roundExistsCount: 2 }) as never)
    const { createKnockoutRound } = await import('./knockout-pairing-actions')
    const r = await createKnockoutRound(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'semi_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[W1, W3], [W2, W4]] }),
      }),
    )
    expect(r?.error).toBeTruthy()
  })
})

describe('swapKnockoutPairing', () => {
  const P1 = '00000000-0000-4000-8000-0000000000b1'
  const P2 = '00000000-0000-4000-8000-0000000000b2'
  const P3 = '00000000-0000-4000-8000-0000000000b3'
  const P4 = '00000000-0000-4000-8000-0000000000b4'

  const SCHEDULED_QF: BracketMatch[] = [
    bm({ id: 'q1', status: 'scheduled', score_a: null, score_b: null, playerA: { id: P1, name: 'P1' }, playerB: { id: P2, name: 'P2' } }),
    bm({ id: 'q2', status: 'scheduled', score_a: null, score_b: null, playerA: { id: P3, name: 'P3' }, playerB: { id: P4, name: 'P4' } }),
  ]

  it('rejects when a match in the round is already played', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    vi.mocked(loadBracketView).mockResolvedValue(
      view([
        {
          round: 'quarter_final',
          label: 'QF',
          matches: [bm({ id: 'q1', status: 'completed', score_a: 1, score_b: 0 }), SCHEDULED_QF[1]],
        },
      ]) as never,
    )
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({}) as never)
    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    const r = await swapKnockoutPairing(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'quarter_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[P1, P3], [P2, P4]] }),
      }),
    )
    expect(r?.error).toBeTruthy()
  })

  it('updates changed rows in place and notifies only affected players', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    const { notifyInApp } = await import('@/lib/notifications/inbox')
    vi.mocked(loadBracketView).mockResolvedValue(
      view([{ round: 'quarter_final', label: 'QF', matches: SCHEDULED_QF }]) as never,
    )
    const updates: Array<{ id: string; row: Record<string, unknown> }> = []
    const inApp: string[] = []
    vi.mocked(notifyInApp).mockImplementation(async ({ playerId }) => {
      inApp.push(playerId)
    })
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        updates,
        profiles: [
          { id: P1, username: 'P1', display_name: 'P1' },
          { id: P2, username: 'P2', display_name: 'P2' },
          { id: P3, username: 'P3', display_name: 'P3' },
          { id: P4, username: 'P4', display_name: 'P4' },
        ],
      }) as never,
    )
    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    const r = await swapKnockoutPairing(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'quarter_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[P1, P3], [P2, P4]] }),
      }),
    )
    expect(r?.success).toBe(true)
    expect(updates.map((u) => u.id).sort()).toEqual(['q1', 'q2'])
    expect(inApp.sort()).toEqual([P1, P2, P3, P4].sort())
  })

  it('is a no-op with no updates when the assignment matches the current pairing', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadBracketView } = await import('./bracket-view')
    vi.mocked(loadBracketView).mockResolvedValue(
      view([{ round: 'quarter_final', label: 'QF', matches: SCHEDULED_QF }]) as never,
    )
    const updates: Array<{ id: string; row: Record<string, unknown> }> = []
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ updates, profiles: [] }) as never)
    const { swapKnockoutPairing } = await import('./knockout-pairing-actions')
    const r = await swapKnockoutPairing(
      undefined,
      fd({
        tournamentId: 't1',
        round: 'quarter_final',
        assignment: JSON.stringify({ byePlayerIds: [], matchPairs: [[P1, P2], [P3, P4]] }),
      }),
    )
    expect(r?.success).toBe(true)
    expect(updates).toEqual([])
  })
})
