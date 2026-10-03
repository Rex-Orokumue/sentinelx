import { describe, it, expect, vi } from 'vitest'
import { replaceGameInterests } from './game-interest-service'

// Records the call order so the add-before-prune guarantee is asserted, not assumed.
function fakeSupabase(opts: { upsertError?: object | null; pruneError?: object | null; clearError?: object | null } = {}) {
  const calls: string[] = []
  const not = vi.fn(() => {
    calls.push('prune')
    return Promise.resolve({ error: opts.pruneError ?? null })
  })
  const eq = vi.fn(() => {
    // delete().eq() is awaited directly when clearing, chained into .not() when pruning.
    const p = Promise.resolve({ error: opts.clearError ?? null }) as Promise<unknown> & { not?: typeof not }
    p.not = not
    return p
  })
  const del = vi.fn(() => ({ eq }))
  const upsert = vi.fn(() => {
    calls.push('upsert')
    return Promise.resolve({ error: opts.upsertError ?? null })
  })
  const from = vi.fn((table: string) => {
    if (table !== 'game_interest') throw new Error('unexpected table ' + table)
    return { delete: del, upsert }
  })
  return { supabase: { from } as never, calls, del, upsert, not }
}

describe('replaceGameInterests', () => {
  it('adds the new set first, then prunes everything outside it', async () => {
    const { supabase, calls, upsert, not } = fakeSupabase()
    const result = await replaceGameInterests(supabase, 'u1', ['g1', 'g2'])
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(['upsert', 'prune'])
    expect(upsert).toHaveBeenCalledWith(
      [
        { user_id: 'u1', game_id: 'g1' },
        { user_id: 'u1', game_id: 'g2' },
      ],
      { onConflict: 'user_id,game_id', ignoreDuplicates: true },
    )
    expect(not).toHaveBeenCalledWith('game_id', 'in', '(g1,g2)')
  })

  it('collapses duplicate ids', async () => {
    const { supabase, upsert } = fakeSupabase()
    await replaceGameInterests(supabase, 'u1', ['g1', 'g1'])
    expect(upsert).toHaveBeenCalledWith([{ user_id: 'u1', game_id: 'g1' }], expect.anything())
  })

  it('clears all interests for an empty array, with no upsert', async () => {
    const { supabase, upsert, del } = fakeSupabase()
    expect(await replaceGameInterests(supabase, 'u1', [])).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('is safe to call twice with the same set', async () => {
    const { supabase } = fakeSupabase()
    expect(await replaceGameInterests(supabase, 'u1', ['g1'])).toEqual({ ok: true })
    expect(await replaceGameInterests(supabase, 'u1', ['g1'])).toEqual({ ok: true })
  })

  it('reports failure when adding errors, and never prunes (the previous set survives)', async () => {
    const { supabase, calls } = fakeSupabase({ upsertError: { message: 'boom' } })
    expect(await replaceGameInterests(supabase, 'u1', ['g1'])).toEqual({ ok: false })
    expect(calls).toEqual(['upsert'])
  })

  it('reports failure when pruning errors', async () => {
    const { supabase } = fakeSupabase({ pruneError: { message: 'boom' } })
    expect(await replaceGameInterests(supabase, 'u1', ['g1'])).toEqual({ ok: false })
  })

  it('reports failure when clearing errors', async () => {
    const { supabase } = fakeSupabase({ clearError: { message: 'boom' } })
    expect(await replaceGameInterests(supabase, 'u1', [])).toEqual({ ok: false })
  })
})
