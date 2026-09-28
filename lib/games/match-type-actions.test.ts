import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMatchType, deleteMatchType, reorderMatchTypes } from './match-type-actions'

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

  it('maps a duplicate name to a friendly error', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: async () => ({ count: 0 }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMatchType(undefined, formDataFrom({ name: 'Best of 7', available: 'false' }))
    expect(result?.error).toMatch(/already exists/)
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
