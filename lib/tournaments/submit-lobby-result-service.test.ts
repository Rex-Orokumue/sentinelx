import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/staff', () => ({ notifyStaff: vi.fn() }))

import { performSubmitLobbyResult } from './submit-lobby-result-service'

function fakeAdmin(opts: {
  callerRow?: Record<string, unknown> | null
  existing?: { id: string; status: string; screenshot_url: string | null } | null
  priorCount?: number
  upsertError?: unknown
}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const update = vi.fn().mockResolvedValue({ error: null })
  const admin = {
    from: (table: string) => {
      if (table === 'lobby_entrants') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.callerRow ?? null }) }) }) }) }
      if (table === 'lobby_results') {
        return {
          select: (_c: string, meta?: { count?: string; head?: boolean }) =>
            meta?.count
              ? { eq: () => Promise.resolve({ count: opts.priorCount ?? 0 }) }
              : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) },
          upsert,
        }
      }
      if (table === 'tournament_lobbies') return { update: () => ({ eq: update }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, upsert, update }
}

const callerRow = {
  entrant_id: 'e1',
  tournament_entrants: { tournament_id: 't1', tournaments: { title: 'Cup' } },
  tournament_lobbies: { status: 'scheduled', stage_id: 's1' },
}
const input = { placement: 3, kills: 5, screenshotPath: 'shots/1.png' }

describe('performSubmitLobbyResult', () => {
  it('reports not_in_lobby when the caller has no entrant row for this lobby', async () => {
    const { admin } = fakeAdmin({ callerRow: null })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'not_in_lobby' })
  })

  it('reports lobby_confirmed once the lobby is locked', async () => {
    const { admin } = fakeAdmin({ callerRow: { ...callerRow, tournament_lobbies: { status: 'confirmed', stage_id: 's1' } } })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'lobby_confirmed' })
  })

  it('reports validation_failed for placement out of range', async () => {
    const { admin } = fakeAdmin({ callerRow })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', { ...input, placement: 0 })
    expect(result).toEqual({ ok: false, errorCode: 'validation_failed' })
  })

  it('reports result_confirmed when the caller already has a confirmed result', async () => {
    const { admin } = fakeAdmin({ callerRow, existing: { id: 'r1', status: 'confirmed', screenshot_url: 'old.png' } })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'result_confirmed' })
  })

  it('reports screenshot_required when neither a new nor an existing screenshot exists', async () => {
    const { admin } = fakeAdmin({ callerRow })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', { ...input, screenshotPath: '' })
    expect(result).toEqual({ ok: false, errorCode: 'screenshot_required' })
  })

  it('upserts placement/kills at zero points and returns ok with the tournamentId, bumping a scheduled lobby to awaiting_results', async () => {
    const { admin, upsert, update } = fakeAdmin({ callerRow })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: true, tournamentId: 't1' })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ lobby_id: 'lob1', entrant_id: 'e1', placement: 3, kills: 5, placement_points: 0, kill_points: 0, status: 'pending' }),
      { onConflict: 'lobby_id,entrant_id' },
    )
    expect(update).toHaveBeenCalled()
  })

  it('does not re-bump the lobby status when it is already awaiting_results', async () => {
    const { admin, update } = fakeAdmin({ callerRow: { ...callerRow, tournament_lobbies: { status: 'awaiting_results', stage_id: 's1' } } })
    await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(update).not.toHaveBeenCalled()
  })

  it('reports submit_failed when the upsert errors', async () => {
    const { admin } = fakeAdmin({ callerRow, upsertError: { message: 'db down' } })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'submit_failed' })
  })
})
