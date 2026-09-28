import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createFormat, updateFormat, deleteFormat, reactivateFormat, reorderFormats } from './format-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createFormat', () => {
  it('rejects a team size outside 1-6 before touching the database', async () => {
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '4v4', entryUnit: 'squad', teamSize: '9', available: 'false' }))
    expect(result?.error).toBeTruthy()
  })

  it('requires a mode', async () => {
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', name: '1v1', entryUnit: 'solo', teamSize: '1', available: 'true' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a slug-only collision (23505) to a friendly error, for names not caught by the name check', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [] }) }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '1v1', entryUnit: 'solo', teamSize: '1', available: 'true' }))
    expect(result?.error).toMatch(/already exists/)
  })

  it('rejects a name that already exists for this mode, even when it would slugify differently than the existing row\'s slug', async () => {
    const insertFn = vi.fn(async () => ({ error: null }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'f0', name: '1v1' }] }) }),
        insert: insertFn,
      }),
    } as never)
    const result = await createFormat(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '1V1', entryUnit: 'solo', teamSize: '1', available: 'true' }))
    expect(result?.error).toMatch(/already exists/)
    expect(insertFn).not.toHaveBeenCalled()
  })
})

describe('updateFormat', () => {
  it('rejects renaming to a name another format on this mode already has', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'f2', name: '2v2' }] }) }),
        update: updateFn,
      }),
    } as never)
    const result = await updateFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1', modeId: 'm1', name: '2v2', entryUnit: 'squad', teamSize: '2', available: 'true' }))
    expect(result?.error).toMatch(/already exists/)
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('updates when the name is unique for this mode', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'f1', name: '1v1' }] }) }),
        update: updateFn,
      }),
    } as never)
    const result = await updateFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1', modeId: 'm1', name: '1v1 Renamed', entryUnit: 'solo', teamSize: '1', available: 'true' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
  })
})

describe('deleteFormat', () => {
  it('hard-deletes when no tournament references this format', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_formats') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament references this format', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_formats') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
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
        if (table === 'game_mode_formats') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reactivateFormat', () => {
  it('requires an id', async () => {
    const result = await reactivateFormat(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('sets active back to true', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reactivateFormat(undefined, formDataFrom({ id: 'f1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalledWith({ active: true })
  })
})

describe('reorderFormats', () => {
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
    const result = await reorderFormats(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
