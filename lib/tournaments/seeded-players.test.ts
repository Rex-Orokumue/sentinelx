import { describe, it, expect, vi } from 'vitest'

function chainable(resolvedData: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in']) {
    builder[method] = vi.fn(() => builder)
  }
  ;(builder as { then: (resolve: (v: { data: unknown }) => void) => void }).then = (resolve) =>
    resolve({ data: resolvedData })
  return builder as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
  }
}

const registrationsChain = chainable([{ player_id: 'active-paid' }])
const profilesChain = chainable([{ id: 'active-paid', sx_score: 700 }])
const from = vi.fn((table: string) => (table === 'profiles' ? profilesChain : registrationsChain))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

describe('seededPaidPlayers', () => {
  it('only pulls active registrations, not disqualified/removed ones that stayed marked paid', async () => {
    const { seededPaidPlayers } = await import('./seeded-players')
    const admin = { from } as unknown as Parameters<typeof seededPaidPlayers>[0]
    await seededPaidPlayers(admin, 't1')
    expect(registrationsChain.eq).toHaveBeenCalledWith('status', 'active')
  })
})
