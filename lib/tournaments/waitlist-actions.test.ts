import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function fd(obj: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('joinWaitlist — username gate', () => {
  it('refuses and returns needsUsername when the caller has no claimed username', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        if (table === 'profiles')
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: null } }) }) }),
          }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    // joinWaitlist now checks the deletion-restriction state through the
    // service-role client before the username gate; report a live account.
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null } }),
          }),
        }),
      }),
    } as never)
    const { joinWaitlist } = await import('./waitlist-actions')
    const r = await joinWaitlist(
      undefined,
      fd({
        tournamentId: 't1',
        displayName: 'X',
        whatsapp: '+2340000000000',
        clubName: 'C',
        ignTag: '',
      }),
    )
    expect(r?.needsUsername).toBe(true)
  })
})
