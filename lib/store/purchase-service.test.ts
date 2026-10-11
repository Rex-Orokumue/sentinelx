import { describe, it, expect, vi, beforeEach } from 'vitest'

const { assertNotPendingDeletion } = vi.hoisted(() => ({ assertNotPendingDeletion: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion }))

import { purchaseItem } from './purchase-service'

function adminWith(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return { admin: { rpc } as never, rpc }
}

beforeEach(() => {
  assertNotPendingDeletion.mockReset().mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('purchaseItem', () => {
  it('calls store_purchase for the player and item and returns the new balance', async () => {
    const { admin, rpc } = adminWith({ data: { status: 'ok', balance: 350 } })
    expect(await purchaseItem(admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: true, balance: 350 })
    expect(rpc).toHaveBeenCalledWith('store_purchase', { p_player: 'p1', p_item: 'i1' })
  })

  it.each([
    ['not_found', 'not_found'],
    ['inactive', 'inactive'],
    ['owned', 'owned'],
    ['insufficient', 'insufficient'],
  ] as const)('maps the %s status to the %s reason', async (status, reason) => {
    const { admin } = adminWith({ data: { status, balance: 10 } })
    expect(await purchaseItem(admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: false, reason })
  })

  it('refuses an account pending deletion without calling the database', async () => {
    assertNotPendingDeletion.mockResolvedValue('Scheduled for deletion.')
    const { admin, rpc } = adminWith({ data: { status: 'ok', balance: 1 } })
    expect(await purchaseItem(admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: false, reason: 'pending_deletion' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports unavailable, never insufficient, when the database call fails or answers nothing usable', async () => {
    expect(await purchaseItem(adminWith({ error: { message: 'down' } }).admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: false, reason: 'unavailable' })
    expect(await purchaseItem(adminWith({ data: null }).admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: false, reason: 'unavailable' })
    expect(await purchaseItem(adminWith({ data: { status: 'something_new' } }).admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('reports unavailable when the call throws', async () => {
    const admin = { rpc: vi.fn().mockRejectedValue(new Error('network')) } as never
    expect(await purchaseItem(admin, { playerId: 'p1', itemId: 'i1' })).toEqual({ ok: false, reason: 'unavailable' })
  })
})
