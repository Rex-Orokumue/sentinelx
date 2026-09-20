import { describe, it, expect, vi, beforeEach } from 'vitest'
import { closeTournamentWithoutWinner } from './no-winner-actions'
import { awardSeasonPoints } from '@/lib/matches/season-points'
import { createAdminClient } from '@/lib/supabase/admin'
import { creditWallet } from '@/lib/wallet/service'

vi.mock('@/lib/admin/auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/matches/season-points', () => ({ awardSeasonPoints: vi.fn() }))
vi.mock('@/lib/matches/revalidate', () => ({ revalidateAll: vi.fn() }))
vi.mock('@/lib/wallet/service', () => ({ creditWallet: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const FINAL = {
  id: 'f1',
  round: 'final',
  status: 'disputed',
  score_a: null,
  score_b: null,
  player_a_id: 'malik',
  player_b_id: 'aag',
  team_a_id: null,
  team_b_id: null,
  admin_note: 'Both claim the win',
}

function fakeAdmin(opts: { status?: string; finals?: object[]; claimOk?: boolean } = {}) {
  const calls = { tournamentPatches: [] as unknown[], matchPatches: [] as unknown[] }
  const client = {
    from(table: string) {
      if (table === 'tournaments') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { status: opts.status ?? 'active', slug: 'fc-cup' } }) }),
          }),
          update: (patch: unknown) => {
            calls.tournamentPatches.push(patch)
            return {
              eq: () => ({
                eq: () => ({ select: async () => ({ data: opts.claimOk === false ? [] : [{ id: 't1' }] }) }),
              }),
            }
          },
        }
      }
      if (table === 'matches') {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: opts.finals ?? [FINAL] }) }) }),
          update: (patch: unknown) => {
            calls.matchPatches.push(patch)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { calls, client }
}

function form(over: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('id', over.id ?? 't1')
  fd.set('reason', over.reason ?? 'Neither player produced a verifiable recording')
  return fd
}

beforeEach(() => vi.clearAllMocks())

describe('closeTournamentWithoutWinner', () => {
  it('requires a reason', async () => {
    const { client } = fakeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    const r = await closeTournamentWithoutWinner(undefined, form({ reason: '   ' }))
    expect(r?.error).toMatch(/reason/i)
    expect(awardSeasonPoints).not.toHaveBeenCalled()
  })

  it('refuses when the final is not disputed', async () => {
    const { client, calls } = fakeAdmin({ finals: [{ ...FINAL, status: 'scheduled' }] })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    const r = await closeTournamentWithoutWinner(undefined, form())
    expect(r?.error).toMatch(/disputed/i)
    expect(calls.tournamentPatches).toEqual([])
    expect(awardSeasonPoints).not.toHaveBeenCalled()
  })

  it('completes the tournament, never touches the final result, and excludes both finalists from rewards', async () => {
    const { client, calls } = fakeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    const r = await closeTournamentWithoutWinner(undefined, form())
    expect(r).toEqual({ success: true })
    expect(calls.tournamentPatches).toEqual([{ status: 'completed' }])
    expect(awardSeasonPoints).toHaveBeenCalledWith(client, 't1', { excludeEntityIds: ['malik', 'aag'] })
    // The only write to the final is the audit note — no score/status/winner.
    expect(calls.matchPatches).toHaveLength(1)
    expect(Object.keys(calls.matchPatches[0] as object)).toEqual(['admin_note'])
    expect((calls.matchPatches[0] as { admin_note: string }).admin_note).toContain('Both claim the win')
    expect((calls.matchPatches[0] as { admin_note: string }).admin_note).toContain(
      'Closed without a winner: Neither player produced a verifiable recording',
    )
  })

  it('pays no prize', async () => {
    const { client } = fakeAdmin()
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    await closeTournamentWithoutWinner(undefined, form())
    expect(creditWallet).not.toHaveBeenCalled()
  })

  it('is idempotent: a lost completion race awards nothing', async () => {
    const { client, calls } = fakeAdmin({ claimOk: false })
    vi.mocked(createAdminClient).mockReturnValue(client as never)
    const r = await closeTournamentWithoutWinner(undefined, form())
    expect(r?.error).toMatch(/already/i)
    expect(awardSeasonPoints).not.toHaveBeenCalled()
    expect(calls.matchPatches).toEqual([])
  })
})
