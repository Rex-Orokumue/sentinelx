import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMatchType, updateMatchType, deleteMatchType, reorderMatchTypes } from './match-type-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMatchType', () => {
  it('rejects an empty name before touching the database', async () => {
    const result = await createMatchType(undefined, formDataFrom({ name: '', available: 'false' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a slug-only collision (23505) to a friendly error, for names not caught by the name check', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: async () => ({ data: [] }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMatchType(undefined, formDataFrom({ name: 'Best of 7', available: 'false' }))
    expect(result?.error).toMatch(/already exists/)
  })

  it('rejects a name that already exists, even when it would slugify differently than the existing row\'s (hand-seeded) slug', async () => {
    // Seeded rows use bo1/bo3/bo5 as their slug; typing "Best of 3" would
    // slugify to 'best_of_3', missing the seeded slug entirely, so the name
    // check has to catch what the slug-based 23505 fallback can't.
    const insertFn = vi.fn(async () => ({ error: null }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: async () => ({ data: [{ id: 'mt0', name: 'Best of 3' }] }),
        insert: insertFn,
      }),
    } as never)
    const result = await createMatchType(undefined, formDataFrom({ name: 'best of 3', available: 'false' }))
    expect(result?.error).toMatch(/already exists/)
    expect(insertFn).not.toHaveBeenCalled()
  })
})

describe('updateMatchType', () => {
  it('rejects renaming to a name another match type already has', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: async () => ({ data: [{ id: 'mt2', name: 'Best of 5' }] }),
        update: updateFn,
      }),
    } as never)
    const result = await updateMatchType(undefined, formDataFrom({ id: 'mt1', name: 'Best of 5', available: 'true' }))
    expect(result?.error).toMatch(/already exists/)
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('updates when the name is unique', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: async () => ({ data: [{ id: 'mt1', name: 'Best of 5' }] }),
        update: updateFn,
      }),
    } as never)
    const result = await updateMatchType(undefined, formDataFrom({ id: 'mt1', name: 'Best of 5 (Grand Final)', available: 'true' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
  })
})

describe('deleteMatchType', () => {
  it('hard-deletes when no tournament references this match type', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'match_types') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchType(undefined, formDataFrom({ id: 'mt1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament references this match type', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'match_types') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchType(undefined, formDataFrom({ id: 'mt1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when the history check itself fails', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'match_types') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchType(undefined, formDataFrom({ id: 'mt1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reorderMatchTypes', () => {
  it('updates seq for each id in order', async () => {
    const eqCalls: string[] = []
    const updateFn = vi.fn((patch: { seq: number }) => ({
      eq: async (_col: string, id: string) => {
        eqCalls.push(`${id}:${patch.seq}`)
        return { error: null }
      },
    }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reorderMatchTypes(undefined, formDataFrom({ orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
