import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { PROFILE_TABLES, OWNER_ID } from '@/lib/testing/profile-fixtures'

type Fake = ReturnType<typeof fakeSupabase>
const state = vi.hoisted(() => ({ fake: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => (state.fake as Fake).client }))

import PlayersPage from './page'

async function render(searchParams: { q?: string }, user: { id: string } | null) {
  const fake = fakeSupabase(PROFILE_TABLES, { user })
  state.fake = fake
  const tree = await PlayersPage({ searchParams })
  return { tree: serializeTree(tree), queries: fake.queries }
}

describe('players directory page — characterization (pins current behavior; must not change during extraction)', () => {
  it('no query, anonymous', async () => {
    const r = await render({}, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })

  it('no query, signed in: the viewer is excluded (neq in the query log)', async () => {
    const r = await render({}, { id: OWNER_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
    expect(r.queries.join(',')).toContain('neq(id)')
    expect(JSON.stringify(r.tree)).not.toContain('"username":"player1"')
  })

  it('with a search term the ilike filter is one recorded or()', async () => {
    const r = await render({ q: 'play' }, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
    expect(r.queries.join(',')).toContain('or')
  })

  it('wildcard / filter-syntax characters do not change the query shape', async () => {
    const r = await render({ q: '50%_,(x)' }, null)
    expect(r.queries).toEqual((await render({ q: 'play' }, null)).queries)
  })
})
