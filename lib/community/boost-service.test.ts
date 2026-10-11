import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/coins/service', () => ({ spendCoins: vi.fn(), recordCoinTransaction: vi.fn(), getCoinBalance: vi.fn() }))
import { spendCoins, recordCoinTransaction } from '@/lib/coins/service'
import { performBoostPost } from './post-service'

const post = { id: 'post1', author_id: 'u1', post_type: 'manual', boosted_until: null }

function fakeAdmin(opts: { post?: Record<string, unknown> | null; activeBoostCount?: number; updateError?: boolean } = {}) {
  const updates: Record<string, unknown>[] = []
  const admin = {
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.gt = () => q
      q.maybeSingle = async () => ({ data: opts.post === undefined ? post : opts.post })
      // the "active boost" count query awaits the chain itself
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: opts.activeBoostCount ?? 0, error: null }).then(resolve)
      q.update = (vals: Record<string, unknown>) => {
        updates.push(vals)
        return { eq: async () => ({ error: opts.updateError ? { message: 'db down' } : null }) }
      }
      return q
    },
  }
  return { admin: admin as never, updates }
}

beforeEach(() => {
  vi.mocked(spendCoins).mockReset()
  vi.mocked(recordCoinTransaction).mockReset()
})

describe('performBoostPost coin handling', () => {
  it('spends the boost cost strictly, then marks the post boosted', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: true, balance: 300 })
    const { admin, updates } = fakeAdmin()
    expect(await performBoostPost(admin, 'u1', 'post1')).toEqual({ ok: true })
    expect(spendCoins).toHaveBeenCalledWith(admin, 'u1', 200, 'post_boost', 'post1', 'Boosted a community post')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toHaveProperty('boosted_until')
  })

  it('reports insufficient_coins and never touches the post when the spend is refused', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: false, reason: 'insufficient' })
    const { admin, updates } = fakeAdmin()
    expect(await performBoostPost(admin, 'u1', 'post1')).toEqual({ ok: false, errorCode: 'insufficient_coins' })
    expect(updates).toHaveLength(0)
  })

  it('reports boost_failed, not insufficient_coins, when the coin service is unavailable', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: false, reason: 'unavailable' })
    const { admin, updates } = fakeAdmin()
    expect(await performBoostPost(admin, 'u1', 'post1')).toEqual({ ok: false, errorCode: 'boost_failed' })
    expect(updates).toHaveLength(0)
  })

  it('credits the coins back when the post update fails', async () => {
    vi.mocked(spendCoins).mockResolvedValue({ ok: true, balance: 300 })
    const { admin } = fakeAdmin({ updateError: true })
    expect(await performBoostPost(admin, 'u1', 'post1')).toEqual({ ok: false, errorCode: 'boost_failed' })
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'u1', 200, 'post_boost', 'post1', 'Boost failed — auto-reversed')
  })

  it('does not spend anything for a post the caller does not own, or that is already boosted', async () => {
    const { admin: foreign } = fakeAdmin({ post: { ...post, author_id: 'someone-else' } })
    expect(await performBoostPost(foreign, 'u1', 'post1')).toEqual({ ok: false, errorCode: 'not_found' })
    const { admin: live } = fakeAdmin({ post: { ...post, boosted_until: new Date(Date.now() + 3_600_000).toISOString() } })
    expect(await performBoostPost(live, 'u1', 'post1')).toEqual({ ok: false, errorCode: 'already_boosted' })
    expect(spendCoins).not.toHaveBeenCalled()
  })
})
