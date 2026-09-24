import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './fake-supabase'

describe('fakeSupabase', () => {
  const tables = { profiles: [{ id: 'a', wins: 3 }, { id: 'b', wins: 1 }, { id: 'c', wins: 5 }] }

  it('applies gte/eq/in filters and ignores order/limit/select', async () => {
    const { client } = fakeSupabase(tables)
    const { data } = await client.from('profiles').select('id, wins').gte('wins', 3).order('wins', { ascending: false }).limit(200)
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(['a', 'c'])
    const r2 = await client.from('profiles').select('id').in('id', ['b', 'c'])
    expect((r2.data as { id: string }[]).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('supports lt on ISO date strings', async () => {
    const { client } = fakeSupabase({ t: [{ id: 1, d: '2026-09-01T00:00:00Z' }, { id: 2, d: '2026-10-01T00:00:00Z' }] })
    const { data } = await client.from('t').select('id').gte('d', '2026-09-01T00:00:00Z').lt('d', '2026-10-01T00:00:00Z')
    expect((data as { id: number }[]).map((r) => r.id)).toEqual([1])
  })

  it('returns a count for head:true selects', async () => {
    const { client } = fakeSupabase(tables)
    const res = await client.from('profiles').select('id', { count: 'exact', head: true })
    expect(res.count).toBe(3)
    expect(res.data).toBeNull()
  })

  it('supports maybeSingle and auth.getUser', async () => {
    const { client } = fakeSupabase(tables, { user: { id: 'a' } })
    const one = await client.from('profiles').select('*').eq('id', 'b').maybeSingle()
    expect(one.data).toEqual({ id: 'b', wins: 1 })
    expect((await client.auth.getUser()).data.user).toEqual({ id: 'a' })
  })

  it('logs every query in order', async () => {
    const { client, queries } = fakeSupabase(tables)
    await client.from('profiles').select('id').eq('id', 'a')
    await client.from('games').select('id')
    expect(queries).toEqual(['profiles:select|eq(id)', 'games:select'])
  })

  it('throws loudly on an unsupported method', () => {
    const { client } = fakeSupabase(tables)
    expect(() => (client.from('profiles') as unknown as { overlaps: () => void }).overlaps()).toThrow(/not supported/)
  })
})

describe('fakeSupabase — or/rpc', () => {
  it('records .or() in the query log and does not filter', async () => {
    const { client, queries } = fakeSupabase({ m: [{ id: 1 }, { id: 2 }] })
    const { data } = await client.from('m').select('id').or('a.eq.1,b.eq.2')
    expect((data as unknown[]).length).toBe(2)
    expect(queries).toEqual(['m:select|or'])
  })

  it('serves rpc() from the provided map and logs it', async () => {
    const { client, queries } = fakeSupabase({}, { rpc: { player_rank: (a: { uname: string }) => (a.uname === 'x' ? 7 : null) } })
    expect((await client.rpc('player_rank', { uname: 'x' })).data).toBe(7)
    expect(queries).toEqual(['rpc:player_rank'])
  })

  it('throws on an rpc with no fixture', async () => {
    const { client } = fakeSupabase({})
    await expect(client.rpc('nope', {})).rejects.toThrow(/no rpc fixture/)
  })
})
