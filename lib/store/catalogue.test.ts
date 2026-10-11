import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { loadStore } from './catalogue'
import { SITE_URL } from '@/lib/seo/site'

const item = (id: string, slug: string, category: string, price: number, sort: number, extra: Record<string, unknown> = {}) => ({
  id, slug, name: `Name ${slug}`, description: `About ${slug}`, category, price_coins: price, preview_url: `/coin-items/${slug}.webp`,
  active: true, sort_order: sort, ...extra,
})

function tables() {
  return {
    store_items: [
      item('i3', 'bubble_a', 'bubble_skin', 300, 1),
      item('i2', 'border_b', 'avatar_border', 300, 2),
      item('i1', 'border_a', 'avatar_border', 150, 1),
      item('i4', 'inactive_one', 'avatar_border', 999, 3, { active: false }),
      item('i5', 'abs', 'username_colour', 150, 1, { preview_url: 'https://cdn.test/abs.webp' }),
    ],
    player_store_items: [
      { player_id: 'me', item_id: 'i1', equipped: true },
      { player_id: 'me', item_id: 'i3', equipped: false },
      { player_id: 'stranger', item_id: 'i2', equipped: true },
    ],
    sx_coins: [
      { player_id: 'me', balance: 1250 },
      { player_id: 'stranger', balance: 99999 },
    ],
  }
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

describe('loadStore', () => {
  it('lists active items only, ordered by category then sort order, with absolute preview URLs', async () => {
    const { client } = fakeSupabase(tables())
    const res = await loadStore(client as never, { playerId: null })
    if (!res.ok) throw new Error('expected store')
    expect(res.items.map((i) => i.slug)).toEqual(['border_a', 'border_b', 'bubble_a', 'abs'])
    expect(res.items.find((i) => i.slug === 'inactive_one')).toBeUndefined()
    expect(res.items[0].previewUrl).toBe(`${SITE_URL}/coin-items/border_a.webp`)
    expect(res.items.find((i) => i.slug === 'abs')!.previewUrl).toBe('https://cdn.test/abs.webp')
  })

  it('signed out: no balance and nothing owned or equipped', async () => {
    const { client } = fakeSupabase(tables())
    const res = await loadStore(client as never, { playerId: null })
    if (!res.ok) throw new Error('expected store')
    expect(res.balance).toBeNull()
    expect(res.items.every((i) => !i.owned && !i.equipped)).toBe(true)
  })

  it("signed in: the caller's balance, ownership and equipped flags only (a stranger's rows never leak)", async () => {
    const { client } = fakeSupabase(tables())
    const res = await loadStore(client as never, { playerId: 'me' })
    if (!res.ok) throw new Error('expected store')
    expect(res.balance).toBe(1250)
    const by = Object.fromEntries(res.items.map((i) => [i.slug, i]))
    expect(by.border_a).toMatchObject({ owned: true, equipped: true })
    expect(by.bubble_a).toMatchObject({ owned: true, equipped: false })
    expect(by.border_b).toMatchObject({ owned: false, equipped: false }) // owned by the stranger, not me
  })

  it('a signed-in player with no coin row has a zero balance', async () => {
    const t = tables()
    t.sx_coins = []
    const res = await loadStore(fakeSupabase(t).client as never, { playerId: 'me' })
    if (!res.ok) throw new Error('expected store')
    expect(res.balance).toBe(0)
  })

  it('reports a failed read instead of an empty store', async () => {
    const failing = {
      from: () => {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'order', 'in']) chain[m] = () => chain
        chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve)
        chain.maybeSingle = async () => ({ data: null, error: { message: 'down' } })
        return chain
      },
    }
    expect(await loadStore(failing as never, { playerId: 'me' })).toEqual({ ok: false })
  })
})
