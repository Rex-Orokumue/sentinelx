/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes for the supabase chain */
import { describe, it, expect } from 'vitest'
import { listChatHistory, clearChatHistory } from './history'

function admin(rows: any[]) {
  const q: Record<string, unknown> = {}
  const chain: any = { select: () => chain, eq: (c: string, v: unknown) => { q[c] = v; return chain }, gte: (c: string, v: unknown) => { q.gte = [c, v]; return chain }, lt: (c: string, v: unknown) => { q.lt = [c, v]; return chain }, or: (v: string) => { q.or = v; return chain }, order: () => chain, limit: (n: number) => { q.limit = n; return Promise.resolve({ data: rows, error: null }) }, delete: () => ({ eq: (c: string, v: unknown) => { q.deleted = [c, v]; return Promise.resolve({ error: null }) } }) }
  return { admin: { from: () => chain } as never, q }
}
describe('listChatHistory', () => {
  it('limits to the player and the 30-day window, returns oldest-first and a cursor when more exist', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, role: 'user', content: 'c' + i, created_at: `2026-10-0${3 - i}T10:00:00.000000+00:00` }))
    const { admin: a, q } = admin(rows)
    const out = await listChatHistory(a, 'u1', { limit: 2 })
    expect(q.player_id).toBe('u1')
    expect(q.limit).toBe(3)
    expect((q.gte as [string, string])[0]).toBe('created_at')
    expect(out.messages.map((m) => m.content)).toEqual(['c1', 'c0']) // newest 2, flipped to oldest-first
    expect(out.nextBefore).not.toBeNull()
  })
  it('no cursor when the page is the last one', async () => {
    const { admin: a } = admin([{ id: '00000000-0000-4000-8000-000000000000', role: 'user', content: 'x', created_at: '2026-10-03T10:00:00.000000+00:00' }])
    expect((await listChatHistory(a, 'u1', {})).nextBefore).toBeNull()
  })
  it('applies the keyset filter when a cursor is given', async () => {
    const { admin: a, q } = admin([])
    const cursor = Buffer.from(JSON.stringify({ t: '2026-10-03T10:00:00.000000+00:00', id: '00000000-0000-4000-8000-000000000000' })).toString('base64url')
    await listChatHistory(a, 'u1', { before: cursor })
    expect(String(q.or)).toContain('created_at.lt.')
  })
})
describe('clearChatHistory', () => {
  it('deletes only the caller rows', async () => {
    const { admin: a, q } = admin([])
    await clearChatHistory(a, 'u1')
    expect(q.deleted).toEqual(['player_id', 'u1'])
  })
})
