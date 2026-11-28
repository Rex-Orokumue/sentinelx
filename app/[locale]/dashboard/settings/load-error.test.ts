import { describe, expect, it, vi } from 'vitest'
import { SettingsLoadError } from '@/components/settings/SettingsLoadError'

const failing = vi.hoisted(() => ({ table: null as string | null }))

// Any chain of query methods, resolving to a row or an error for its table.
const client = vi.hoisted(() => () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.test' } } }),
    getUserIdentities: async () => ({ data: { identities: [] } }),
  },
  from(table: string) {
    const failed = failing.table === table
    const row = table === 'profiles' ? { username: 'ada', display_name: 'Ada' } : null
    const result = { data: failed ? null : table === 'profiles' ? row : [], error: failed ? { message: 'fetch failed' } : null, count: 0 }
    const query: unknown = new Proxy(
      {},
      { get: (_t, key) => (key === 'then' ? (resolve: (v: unknown) => void) => resolve(result) : () => query) },
    )
    return query
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: client }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({}) }))

import SettingsPage from './page'

const render = () => SettingsPage({ searchParams: {} })

describe('settings page when the database read fails', () => {
  it.each(['profiles', 'games', 'game_interest'])('shows an error instead of a blank form (%s)', async (table) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    failing.table = table
    expect((await render()).type).toBe(SettingsLoadError)
  })

  it('shows the settings when the reads succeed', async () => {
    failing.table = null
    expect((await render()).type).not.toBe(SettingsLoadError)
  })
})
