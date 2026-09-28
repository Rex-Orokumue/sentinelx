import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMatchRule, updateMatchRule, deleteMatchRule, reactivateMatchRule, reorderMatchRules } from './match-rule-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMatchRule', () => {
  it('rejects an empty name before touching the database', async () => {
    const result = await createMatchRule(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: '' }))
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
    const result = await createMatchRule(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: 'Headshot only' }))
    expect(result?.error).toMatch(/already exists/)
  })

  it('rejects a name that already exists for this mode, even when it would slugify differently than the existing row\'s (hand-seeded) slug', async () => {
    // PUBG's TPP rule was seeded with slug 'tpp'; typing "TPP" again produces
    // the same slug here, but Free Fire's 'spam' seed for "Spam / unlimited
    // ammo" would not — the name check must catch what the slug misses.
    const insertFn = vi.fn(async () => ({ error: null }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'r0', name: 'Headshot only' }] }) }),
        insert: insertFn,
      }),
    } as never)
    const result = await createMatchRule(undefined, formDataFrom({ gameId: 'g1', modeId: 'm1', name: 'headshot only' }))
    expect(result?.error).toMatch(/already exists/)
    expect(insertFn).not.toHaveBeenCalled()
  })
})

describe('updateMatchRule', () => {
  it('rejects renaming to a name another rule on this mode already has', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'r2', name: 'Spam' }] }) }),
        update: updateFn,
      }),
    } as never)
    const result = await updateMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1', modeId: 'm1', name: 'Spam' }))
    expect(result?.error).toMatch(/already exists/)
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('updates when the name is unique for this mode', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'r1', name: 'Headshot only' }] }) }),
        update: updateFn,
      }),
    } as never)
    const result = await updateMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1', modeId: 'm1', name: 'Headshot only v2' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
  })
})

describe('deleteMatchRule', () => {
  it('hard-deletes when no tournament references this rule', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_match_rules') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a tournament references this rule', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_mode_match_rules') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
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
        if (table === 'game_mode_match_rules') return { delete: deleteFn, update: updateFn }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reactivateMatchRule', () => {
  it('requires an id', async () => {
    const result = await reactivateMatchRule(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('sets active back to true', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reactivateMatchRule(undefined, formDataFrom({ id: 'r1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalledWith({ active: true })
  })
})

describe('reorderMatchRules', () => {
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
    const result = await reorderMatchRules(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
