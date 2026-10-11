import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setItemEquipped } from './equip-service'

function adminWith(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  return { admin: { rpc } as never, rpc }
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

describe('setItemEquipped', () => {
  it('equips through store_equip and returns the category', async () => {
    const { admin, rpc } = adminWith({ data: { status: 'ok', category: 'avatar_border' } })
    expect(await setItemEquipped(admin, { playerId: 'p1', itemId: 'i1', equipped: true })).toEqual({ ok: true, category: 'avatar_border' })
    expect(rpc).toHaveBeenCalledWith('store_equip', { p_player: 'p1', p_item: 'i1', p_equipped: true })
  })

  it('unequips by passing equipped:false', async () => {
    const { admin, rpc } = adminWith({ data: { status: 'ok', category: 'username_colour' } })
    expect(await setItemEquipped(admin, { playerId: 'p1', itemId: 'i1', equipped: false })).toEqual({ ok: true, category: 'username_colour' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_equipped: false })
  })

  it.each([['not_found'], ['not_owned']] as const)('maps %s', async (status) => {
    const { admin } = adminWith({ data: { status } })
    expect(await setItemEquipped(admin, { playerId: 'p1', itemId: 'i1', equipped: true })).toEqual({ ok: false, reason: status })
  })

  it('reports unavailable when the database fails, answers nothing, or throws', async () => {
    expect(await setItemEquipped(adminWith({ error: { message: 'down' } }).admin, { playerId: 'p1', itemId: 'i1', equipped: true })).toEqual({ ok: false, reason: 'unavailable' })
    expect(await setItemEquipped(adminWith({ data: null }).admin, { playerId: 'p1', itemId: 'i1', equipped: true })).toEqual({ ok: false, reason: 'unavailable' })
    const thrown = { rpc: vi.fn().mockRejectedValue(new Error('x')) } as never
    expect(await setItemEquipped(thrown, { playerId: 'p1', itemId: 'i1', equipped: true })).toEqual({ ok: false, reason: 'unavailable' })
  })
})
