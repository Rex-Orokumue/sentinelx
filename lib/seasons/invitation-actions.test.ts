import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'

const h = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.client }))
vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn(async () => ({})) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notifications/notify', () => ({ notify: vi.fn(async () => {}) }))
vi.mock('@/lib/notifications/inbox', () => ({ notifyInApp: vi.fn(async () => {}) }))

import { notify } from '@/lib/notifications/notify'
import { notifyInApp } from '@/lib/notifications/inbox'
import {
  cascadeNextInvitation,
  manuallyAddInvitee,
  reinviteExpiredInvitations,
  sendInvitations,
  triggerCascadeNow,
} from './invitation-actions'

type Row = Record<string, unknown>
const SEASON = 's1'
const GAME = 'dls'
const MASTERS = 'masters'

function player(id: string, sx = 1000, extra: Row = {}): Row {
  return { id, username: id, display_name: id, avatar_url: null, sx_score: sx, deleted_at: null, ...extra }
}
function inv(playerId: string, status: string): Row {
  return {
    tournament_id: MASTERS,
    player_id: playerId,
    status,
    rank_at_invite: 0,
    expires_at: '2026-09-30T20:00:00.000Z',
    invited_at: '2026-09-28T20:00:00.000Z',
    responded_at: status === 'expired' ? '2026-10-02T20:00:00.000Z' : null,
  }
}

// A September qualifier feeding an October Masters — the exact shape that used to yield an empty pool.
function world(opts: { players: Row[]; points: Record<string, number>; invitations?: Row[] }) {
  const tables: Record<string, Row[]> = {
    tournaments: [
      { id: 'cup', season_id: SEASON, game_id: GAME, tournament_type: 'community_club', tournament_start: '2026-09-07T00:00:00.000Z', title: 'Cup' },
      {
        id: MASTERS,
        season_id: SEASON,
        game_id: GAME,
        tournament_type: 'masters',
        tournament_start: '2026-10-06T00:00:00.000Z',
        title: 'DLS Masters Cup',
        registration_fee: 500,
      },
    ],
    season_ranking_points: Object.entries(opts.points).map(([player_id, points]) => ({ season_id: SEASON, tournament_id: 'cup', player_id, points })),
    matches: [],
    season_noshow_penalties: [],
    profiles: opts.players,
    tournament_invitations: opts.invitations ?? [],
  }
  const { client } = fakeSupabase(tables, { unique: { tournament_invitations: ['tournament_id', 'player_id'] } })
  h.client = client
  return tables
}

const form = (entries: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}
const invitedIds = (tables: Record<string, Row[]>, status?: string) =>
  tables.tournament_invitations.filter((r) => !status || r.status === status).map((r) => r.player_id)
const notifiedIds = () => vi.mocked(notify).mock.calls.map((c) => c[0].playerId)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendInvitations', () => {
  it('invites by rank for a Masters that starts the month after its qualifiers, and notifies every invitee', async () => {
    const t = world({
      players: [player('a'), player('b'), player('c')],
      points: { a: 30, b: 20, c: 10 },
    })
    const res = await sendInvitations(undefined, form({ tournamentId: MASTERS }))
    expect(res).toEqual({ success: true, invited: 3 })
    expect(invitedIds(t)).toEqual(['a', 'b', 'c'])
    expect(notifiedIds()).toEqual(['a', 'b', 'c'])
    expect(vi.mocked(notifyInApp).mock.calls.map((c) => c[0].playerId)).toEqual(['a', 'b', 'c'])
    expect(t.tournament_invitations.map((r) => r.rank_at_invite)).toEqual([1, 2, 3])
  })

  it('never invites an anonymised (deleted) account or one under the SX floor', async () => {
    const t = world({
      players: [player('a'), player('gone', 1000, { deleted_at: '2026-09-20T00:00:00Z' }), player('low', 399), player('b')],
      points: { a: 30, gone: 25, low: 20, b: 10 },
    })
    await sendInvitations(undefined, form({ tournamentId: MASTERS }))
    expect(invitedIds(t)).toEqual(['a', 'b'])
  })

  it('refuses a second full send and points the admin at the cascade button', async () => {
    world({ players: [player('a')], points: { a: 5 }, invitations: [inv('a', 'pending')] })
    const res = await sendInvitations(undefined, form({ tournamentId: MASTERS }))
    expect(res?.error).toMatch(/Check & Cascade/)
  })
})

describe('cascade slot accounting', () => {
  it('does not invite anyone while pending + accepted invitations already fill the 16 slots', async () => {
    const players = Array.from({ length: 20 }, (_, i) => player(`p${i}`))
    const points = Object.fromEntries(players.map((p, i) => [p.id as string, 100 - i]))
    const t = world({
      players,
      points,
      invitations: [...Array.from({ length: 15 }, (_, i) => inv(`p${i}`, 'pending')), inv('p15', 'accepted')],
    })
    expect(await cascadeNextInvitation(h.client as never, MASTERS)).toEqual({ invited: 0 })
    expect(invitedIds(t)).toHaveLength(16)
  })

  it('replaces exactly the slots that opened up', async () => {
    const players = Array.from({ length: 20 }, (_, i) => player(`p${i}`))
    const points = Object.fromEntries(players.map((p, i) => [p.id as string, 100 - i]))
    const t = world({
      players,
      points,
      invitations: [...Array.from({ length: 14 }, (_, i) => inv(`p${i}`, 'pending')), inv('p14', 'declined'), inv('p15', 'accepted')],
    })
    expect((await cascadeNextInvitation(h.client as never, MASTERS)).invited).toBe(1)
    expect(invitedIds(t).slice(-1)).toEqual(['p16'])
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'invitation_expired_cascade', playerId: 'p16' }))
  })

  it('the admin cascade button tops up even when nothing expired in this run', async () => {
    const t = world({
      players: [player('a'), player('b'), player('c')],
      points: { a: 3, b: 2, c: 1 },
      invitations: [inv('a', 'accepted')],
    })
    const res = await triggerCascadeNow(undefined, form({ tournamentId: MASTERS }))
    expect(res).toEqual({ success: true, invited: 2 })
    expect(invitedIds(t)).toEqual(['a', 'b', 'c'])
  })
})

describe('manuallyAddInvitee', () => {
  it('matches the username case-insensitively, inserts the row and notifies the player', async () => {
    const t = world({ players: [player('Cristiano')], points: { Cristiano: 45 } })
    const res = await manuallyAddInvitee(undefined, form({ tournamentId: MASTERS, username: 'cristiano' }))
    expect(res).toEqual({ success: true })
    expect(invitedIds(t)).toEqual(['Cristiano'])
    expect(notifiedIds()).toEqual(['Cristiano'])
    expect(notifyInApp).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown or deleted player and a duplicate live invitation', async () => {
    world({
      players: [player('a'), player('gone', 1000, { deleted_at: '2026-09-20T00:00:00Z' })],
      points: {},
      invitations: [inv('a', 'pending')],
    })
    expect((await manuallyAddInvitee(undefined, form({ tournamentId: MASTERS, username: 'nobody' })))?.error).toMatch(/No player found/)
    expect((await manuallyAddInvitee(undefined, form({ tournamentId: MASTERS, username: 'gone' })))?.error).toMatch(/No player found/)
    expect((await manuallyAddInvitee(undefined, form({ tournamentId: MASTERS, username: 'a' })))?.error).toMatch(/already has an invitation \(pending\)/)
    expect(notify).not.toHaveBeenCalled()
  })

  it('revives an expired invitation instead of failing as a duplicate, with a fresh deadline and its own dedupe key', async () => {
    const t = world({ players: [player('a')], points: { a: 5 }, invitations: [inv('a', 'expired')] })
    const res = await manuallyAddInvitee(undefined, form({ tournamentId: MASTERS, username: 'a' }))
    expect(res).toEqual({ success: true })
    expect(t.tournament_invitations).toHaveLength(1)
    expect(t.tournament_invitations[0]).toMatchObject({ status: 'pending', responded_at: null })
    expect(new Date(t.tournament_invitations[0].expires_at as string).getTime()).toBeGreaterThan(Date.now())
    const key = vi.mocked(notify).mock.calls[0][0].dedupeKey
    expect(key).toMatch(/^season_reinvite:masters:a:/)
  })
})

describe('reinviteExpiredInvitations', () => {
  it('revives expired players and invites never-invited ones strictly by rank, holding the overflow back', async () => {
    // 1 accepted holds a slot -> 15 open. 12 expired + 4 never invited = 16 candidates: the lowest-ranked one is held.
    const expired = Array.from({ length: 12 }, (_, i) => `e${i}`)
    const fresh = ['n0', 'n1', 'n2', 'n3']
    const players = [player('acc'), ...expired.map((id) => player(id)), ...fresh.map((id) => player(id))]
    const points: Record<string, number> = { acc: 200 }
    expired.forEach((id, i) => (points[id] = 60 - i)) // 60..49
    fresh.forEach((id, i) => (points[id] = 95 - i * 10)) // 95..65, all above the expired ones
    const t = world({ players, points, invitations: [inv('acc', 'accepted'), ...expired.map((id) => inv(id, 'expired'))] })

    const res = await reinviteExpiredInvitations(undefined, form({ tournamentId: MASTERS }))
    expect(res).toEqual({ success: true, invited: 15 })
    expect(invitedIds(t, 'pending')).toHaveLength(15)
    expect(invitedIds(t, 'expired')).toHaveLength(1)
    // The one held back is the lowest-ranked candidate: the last expired player (the reserve), like Danny in prod.
    expect(invitedIds(t, 'expired')).toEqual(['e11'])
    expect(invitedIds(t, 'pending')).toEqual(expect.arrayContaining(['n0', 'n1', 'n2', 'n3', 'e0', 'e10']))
    expect(notify).toHaveBeenCalledTimes(15)
    expect(notifiedIds()).not.toContain('acc')
  })

  it('does not touch declined players and leaves expired ones below the SX floor expired', async () => {
    const t = world({
      players: [player('a'), player('dec'), player('low', 100)],
      points: { a: 5, dec: 50, low: 40 },
      invitations: [inv('a', 'expired'), inv('dec', 'declined'), inv('low', 'expired')],
    })
    await reinviteExpiredInvitations(undefined, form({ tournamentId: MASTERS }))
    const status = Object.fromEntries(t.tournament_invitations.map((r) => [r.player_id, r.status]))
    expect(status).toEqual({ a: 'pending', dec: 'declined', low: 'expired' })
  })

  it('is a no-op the second time (revived players now hold their slots)', async () => {
    const t = world({ players: [player('a'), player('b')], points: { a: 5, b: 4 }, invitations: [inv('a', 'expired')] })
    await reinviteExpiredInvitations(undefined, form({ tournamentId: MASTERS }))
    const after = invitedIds(t).length
    vi.clearAllMocks()
    await reinviteExpiredInvitations(undefined, form({ tournamentId: MASTERS }))
    expect(invitedIds(t)).toHaveLength(after)
    expect(notify).not.toHaveBeenCalled()
  })
})
