import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { SEASON_FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.fake!.client }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))

import SeasonPage from './page'

describe('season page — characterization', () => {
  it('renders sections for every active game', async () => {
    state.fake = fakeSupabase(SEASON_FIXTURE_TABLES, { user: { id: 'p1' } })
    const tree = await SeasonPage({ params: { slug: 'season-1' } })
    expect(serializeTree(tree)).toMatchSnapshot('tree')
    expect(state.fake!.queries).toMatchSnapshot('queries')
  })
  it('404s on an unknown slug', async () => {
    state.fake = fakeSupabase(SEASON_FIXTURE_TABLES)
    await expect(SeasonPage({ params: { slug: 'nope' } })).rejects.toThrow('NOT_FOUND')
  })
})
