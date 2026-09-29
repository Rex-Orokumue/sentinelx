import { describe, it, expect, vi } from 'vitest'
import { replaceGameInterests } from './game-interest-service'

function fakeSupabase(opts: { delError?: object | null; insError?: object | null } = {}) {
  const del = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: opts.delError ?? null }) }))
  const insert = vi.fn().mockResolvedValue({ error: opts.insError ?? null })
  const from = vi.fn((table: string) => {
    if (table !== 'game_interest') throw new Error(`unexpected table ${table}`)
    return { delete: del, insert }
  })
  return { supabase: { from } as never, del, insert }
}

describe('replaceGameInterests', () => {
  it('deletes existing rows then inserts the new set', async () => {
    const { supabase, del, insert } = fakeSupabase()
    const result = await replaceGameInterests(supabase, 'u1', ['g1', 'g2'])
    expect(result).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith([
      { user_id: 'u1', game_id: 'g1' },
      { user_id: 'u1', game_id: 'g2' },
    ])
  })

  it('clears all interests when given an empty array, without an insert call', async () => {
    const { supabase, del, insert } = fakeSupabase()
    const result = await replaceGameInterests(supabase, 'u1', [])
    expect(result).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('is safe to call twice with the same set (delete+reinsert, not an error)', async () => {
    const { supabase } = fakeSupabase()
    const first = await replaceGameInterests(supabase, 'u1', ['g1'])
    const second = await replaceGameInterests(supabase, 'u1', ['g1'])
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
  })

  it('reports failure when the delete errors, without attempting the insert', async () => {
    const { supabase, insert } = fakeSupabase({ delError: { message: 'boom' } })
    const result = await replaceGameInterests(supabase, 'u1', ['g1'])
    expect(result).toEqual({ ok: false })
    expect(insert).not.toHaveBeenCalled()
  })

  it('reports failure when the insert errors', async () => {
    const { supabase } = fakeSupabase({ insError: { message: 'boom' } })
    const result = await replaceGameInterests(supabase, 'u1', ['g1'])
    expect(result).toEqual({ ok: false })
  })
})
