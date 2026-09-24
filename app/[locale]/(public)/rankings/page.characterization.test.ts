import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_TABLES, FIXTURE_NOW, VIEWER_ID } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))

import RankingsPage from './page'

async function render(searchParams: Record<string, string>, user: { id: string } | null) {
  state.fake = fakeSupabase(FIXTURE_TABLES, { user }) as never
  const tree = await RankingsPage({ searchParams })
  return { tree: serializeTree(tree), queries: state.fake!.queries }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXTURE_NOW)) })
afterEach(() => vi.useRealTimers())

describe('rankings page — characterization (pins current behavior; must not change during extraction)', () => {
  it('overall board, anonymous', async () => {
    const r = await render({}, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('overall board, signed in (viewer row pinned when off-page)', async () => {
    const r = await render({ page: '1' }, { id: VIEWER_ID })
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('game board (dls) narrows to players who competed', async () => {
    const r = await render({ game: 'dls' }, null)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('region filter', async () => {
    const r = await render({ region: 'GH' }, null)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('out-of-range page clamps', async () => {
    const r = await render({ page: '99' }, null)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('fixtures actually exercise the interesting paths (guards against an empty, vacuous snapshot)', async () => {
    const json = JSON.stringify((await render({}, null)).tree)
    expect(json).toContain('player1')
    expect(json).toContain('"direction"')
  })
})
