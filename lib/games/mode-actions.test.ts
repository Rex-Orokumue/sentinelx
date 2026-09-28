import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/auth', () => ({ requireStaff: vi.fn().mockResolvedValue({ isAdmin: true }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createMode, updateMode, deleteMode, reactivateMode, reorderModes } from './mode-actions'

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj)) fd.set(k, v)
  return fd
}

describe('createMode', () => {
  it('rejects an invalid competition format before touching the database', async () => {
    const result = await createMode(undefined, formDataFrom({ gameId: 'g1', name: 'Battle Royale', competitionFormat: 'nonsense' }))
    expect(result?.error).toBeTruthy()
  })

  it('requires a game', async () => {
    const result = await createMode(undefined, formDataFrom({ name: 'Battle Royale', competitionFormat: 'points_race' }))
    expect(result?.error).toBeTruthy()
  })

  it('maps a slug-only collision (23505) to a friendly error, for names that clash after slugifying but were not caught by the name check', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [] }) }),
        insert: async () => ({ error: { code: '23505' } }),
      }),
    } as never)
    const result = await createMode(undefined, formDataFrom({ gameId: 'g1', name: 'Battle Royale', competitionFormat: 'points_race' }))
    expect(result?.error).toMatch(/already exists/)
  })

  it('rejects a name that already exists for this game, even when it would slugify differently than the existing row\'s (hand-seeded) slug', async () => {
    // Free Fire's Battle Royale mode was seeded with slug 'battle_royale' by
    // migration; typing "Battle Royale" again would slugify to the SAME
    // thing here, but a seeded slug like 'bo3' for "Best of 3" would not —
    // the name check must catch the collision the slug-based 23505 misses.
    const insertFn = vi.fn(async () => ({ error: null }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: async () => ({ data: [{ id: 'm0', name: 'Battle Royale' }] }) }),
        insert: insertFn,
      }),
    } as never)
    const result = await createMode(undefined, formDataFrom({ gameId: 'g1', name: 'battle royale', competitionFormat: 'points_race' }))
    expect(result?.error).toMatch(/already exists/)
    expect(insertFn).not.toHaveBeenCalled()
  })
})

describe('updateMode', () => {
  it('rejects renaming to a name another mode in this game already has', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') {
          return {
            select: () => ({ eq: async () => ({ data: [{ id: 'm2', name: 'Clash Squad' }] }) }),
            update: updateFn,
          }
        }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await updateMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1', name: 'Clash Squad', competitionFormat: 'head_to_head' }))
    expect(result?.error).toMatch(/already exists/)
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('refuses to change competition_format when the mode is referenced by a tournament', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') {
          return {
            select: (cols: string) =>
              cols === 'competition_format'
                ? { eq: () => ({ limit: async () => ({ data: [{ competition_format: 'head_to_head' }] }) }) }
                : { eq: async () => ({ data: [] }) },
            update: updateFn,
          }
        }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await updateMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1', name: 'Clash Squad', competitionFormat: 'points_race' }))
    expect(result?.error).toMatch(/competition format/)
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('allows renaming a referenced mode as long as competition_format is unchanged', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') {
          return {
            select: (cols: string) =>
              cols === 'competition_format'
                ? { eq: () => ({ limit: async () => ({ data: [{ competition_format: 'head_to_head' }] }) }) }
                : { eq: async () => ({ data: [] }) },
            update: updateFn,
          }
        }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 't1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await updateMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1', name: 'Clash Squad Renamed', competitionFormat: 'head_to_head' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
  })

  it('allows changing competition_format on a mode no tournament references', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') {
          return {
            select: (cols: string) =>
              cols === 'competition_format'
                ? { eq: () => ({ limit: async () => ({ data: [{ competition_format: 'head_to_head' }] }) }) }
                : { eq: async () => ({ data: [] }) },
            update: updateFn,
          }
        }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await updateMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1', name: 'Clash Squad', competitionFormat: 'points_race' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
  })
})

describe('deleteMode', () => {
  it('requires an id', async () => {
    const result = await deleteMode(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('hard-deletes a mode with no history anywhere in its subtree', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(deleteFn).toHaveBeenCalled()
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a descendant format is referenced by a tournament, even though the mode itself is not', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [{ id: 'f1' }] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') {
          return {
            select: () => ({
              eq: () => ({ limit: async () => ({ data: [] }) }),
              in: (col: string) => ({
                limit: async () => (col === 'format_id' ? { data: [{ id: 't1' }] } : { data: [] }),
              }),
            }),
          }
        }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates instead of deleting when a descendant map is referenced only via tournament_lobbies', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [{ id: 'map1' }] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [{ id: 'lobby1' }] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('deactivates rather than hard-deletes when a history check itself fails, since a false negative is destructive', async () => {
    const deleteFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'game_modes') return { delete: deleteFn, update: updateFn }
        if (table === 'game_mode_formats') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_maps') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'game_mode_match_rules') return { select: () => ({ eq: async () => ({ data: [] }) }) }
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'connection reset' } }) }), in: () => ({ limit: async () => ({ data: [] }) }) }) }
        if (table === 'tournament_lobbies') return { select: () => ({ in: () => ({ limit: async () => ({ data: [] }) }) }) }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const result = await deleteMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

describe('reactivateMode', () => {
  it('requires an id', async () => {
    const result = await reactivateMode(undefined, formDataFrom({ gameId: 'g1' }))
    expect(result?.error).toBeTruthy()
  })

  it('sets active back to true', async () => {
    const updateFn = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({ from: () => ({ update: updateFn }) } as never)
    const result = await reactivateMode(undefined, formDataFrom({ id: 'm1', gameId: 'g1' }))
    expect(result?.success).toBe(true)
    expect(updateFn).toHaveBeenCalledWith({ active: true })
  })
})

describe('reorderModes', () => {
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
    const result = await reorderModes(undefined, formDataFrom({ gameId: 'g1', orderedIds: JSON.stringify(['a', 'b']) }))
    expect(result?.success).toBe(true)
    expect(eqCalls).toEqual(['a:1', 'b:2'])
  })
})
