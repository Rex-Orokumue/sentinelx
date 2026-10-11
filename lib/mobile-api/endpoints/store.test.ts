import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  optionalAuth: vi.fn(),
  runIdempotent: vi.fn(),
  loadStore: vi.fn(),
  purchaseItem: vi.fn(),
  setItemEquipped: vi.fn(),
}))
vi.mock('../auth', () => ({ authenticate: m.authenticate, optionalAuth: m.optionalAuth }))
vi.mock('../idempotency', () => ({ runIdempotent: m.runIdempotent }))
vi.mock('@/lib/store/catalogue', () => ({ loadStore: m.loadStore }))
vi.mock('@/lib/store/purchase-service', () => ({ purchaseItem: m.purchaseItem }))
vi.mock('@/lib/store/equip-service', () => ({ setItemEquipped: m.setItemEquipped }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => 'public-admin' }))

import { getStoreEndpoint, purchaseStoreItemEndpoint, equipStoreItemEndpoint, unequipStoreItemEndpoint } from './store'
import { Errors } from '../errors'

const BASE = 'https://x.test/api/mobile/v1'
const ITEM = '11111111-1111-4111-8111-111111111111'

function req(method: string, path: string, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, { method, headers })
}
const json = async (res: Response) => res.json()
const items = [{ id: ITEM, slug: 'avatar_border_bronze', name: 'Bronze', description: null, category: 'avatar_border', priceCoins: 150, previewUrl: 'https://s.test/b.webp', owned: false, equipped: false }]

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.authenticate.mockResolvedValue({ userId: 'owner-1', email: 'o@x.test', admin: 'admin' })
  m.optionalAuth.mockResolvedValue(null)
  m.runIdempotent.mockImplementation(async (_a: unknown, _k: unknown, run: () => unknown) => run())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /store', () => {
  it('serves the public catalogue signed out, with no balance and nothing owned', async () => {
    m.loadStore.mockResolvedValue({ ok: true, balance: null, items })
    const res = await getStoreEndpoint.handler(req('GET', '/store'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await json(res)).data).toEqual({ balance: null, items })
    expect(m.loadStore).toHaveBeenCalledWith('public-admin', { playerId: null })
  })

  it('scopes ownership and balance to the signed-in caller', async () => {
    m.optionalAuth.mockResolvedValue({ userId: 'owner-1', admin: 'admin' })
    m.loadStore.mockResolvedValue({ ok: true, balance: 1250, items })
    const res = await getStoreEndpoint.handler(req('GET', '/store', { authorization: 'Bearer t' }))
    expect((await json(res)).data.balance).toBe(1250)
    expect(m.loadStore).toHaveBeenCalledWith('public-admin', { playerId: 'owner-1' })
  })

  it('maps a failed read to 500 store_load_failed', async () => {
    m.loadStore.mockResolvedValue({ ok: false })
    const res = await getStoreEndpoint.handler(req('GET', '/store'))
    expect(res.status).toBe(500)
    expect((await json(res)).error.code).toBe('store_load_failed')
  })
})

describe('POST /store/{itemId}/purchase', () => {
  const call = (headers: Record<string, string> = { 'idempotency-key': 'k1' }, id = ITEM) =>
    purchaseStoreItemEndpoint.handler(req('POST', `/store/${id}/purchase`, headers), { params: { itemId: id } })

  it('requires sign-in', async () => {
    m.authenticate.mockRejectedValue(Errors.unauthorized())
    expect((await call()).status).toBe(401)
  })

  it('requires an Idempotency-Key', async () => {
    const res = await call({})
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('idempotency_key_required')
    expect(m.purchaseItem).not.toHaveBeenCalled()
  })

  it('buys for ctx.userId, returns the new balance, and is keyed by caller and route', async () => {
    m.purchaseItem.mockResolvedValue({ ok: true, balance: 350 })
    const res = await call()
    expect((await json(res)).data).toEqual({ balance: 350, itemId: ITEM })
    expect(m.purchaseItem).toHaveBeenCalledWith('admin', { playerId: 'owner-1', itemId: ITEM })
    expect(m.runIdempotent).toHaveBeenCalledWith('admin', { key: 'k1', userId: 'owner-1', route: `/api/mobile/v1/store/${ITEM}/purchase` }, expect.any(Function))
  })

  it.each([
    ['not_found', 404, 'not_found'],
    ['inactive', 409, 'item_unavailable'],
    ['owned', 409, 'already_owned'],
    ['insufficient', 422, 'insufficient_coins'],
    ['unavailable', 503, 'store_unavailable'],
    ['pending_deletion', 403, 'account_pending_deletion'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    m.purchaseItem.mockResolvedValue({ ok: false, reason })
    const res = await call()
    expect(res.status).toBe(status)
    expect((await json(res)).error.code).toBe(code)
  })

  it('treats a malformed item id as not_found before calling any service', async () => {
    const res = await call({ 'idempotency-key': 'k1' }, 'not-a-uuid')
    expect(res.status).toBe(404)
    expect(m.purchaseItem).not.toHaveBeenCalled()
  })
})

describe.each([
  ['equip', equipStoreItemEndpoint, true],
  ['unequip', unequipStoreItemEndpoint, false],
] as const)('POST /store/{itemId}/%s', (name, endpoint, equipped) => {
  const call = (id = ITEM) => endpoint.handler(req('POST', `/store/${id}/${name}`), { params: { itemId: id } })

  it('requires sign-in', async () => {
    m.authenticate.mockRejectedValue(Errors.unauthorized())
    expect((await call()).status).toBe(401)
  })

  it(`calls the service with equipped:${equipped} for ctx.userId and returns the category`, async () => {
    m.setItemEquipped.mockResolvedValue({ ok: true, category: 'avatar_border' })
    const res = await call()
    expect((await json(res)).data).toEqual({ itemId: ITEM, category: 'avatar_border' })
    expect(m.setItemEquipped).toHaveBeenCalledWith('admin', { playerId: 'owner-1', itemId: ITEM, equipped })
  })

  it.each([
    ['not_found', 404, 'not_found'],
    ['not_owned', 409, 'not_owned'],
    ['unavailable', 503, 'store_unavailable'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    m.setItemEquipped.mockResolvedValue({ ok: false, reason })
    const res = await call()
    expect(res.status).toBe(status)
    expect((await json(res)).error.code).toBe(code)
  })

  it('treats a malformed item id as not_found', async () => {
    expect((await call('nope')).status).toBe(404)
    expect(m.setItemEquipped).not.toHaveBeenCalled()
  })
})
