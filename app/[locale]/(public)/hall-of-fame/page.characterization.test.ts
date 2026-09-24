import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_TABLES, FIXTURE_NOW } from '@/lib/testing/progress-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))

import HallOfFamePage from './page'

async function render(searchParams: Record<string, string>) {
  state.fake = fakeSupabase(FIXTURE_TABLES, { user: null }) as never
  const tree = await HallOfFamePage({ searchParams })
  return { tree: serializeTree(tree), queries: state.fake!.queries }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXTURE_NOW)) })
afterEach(() => vi.useRealTimers())

describe('hall-of-fame page — characterization', () => {
  it('all games', async () => {
    const r = await render({})
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('filtered to one game', async () => {
    expect((await render({ game: 'dls' })).tree).toMatchSnapshot('tree')
  })
  it('unknown game slug falls back to all games', async () => {
    expect((await render({ game: 'nope' })).tree).toEqual((await render({})).tree)
  })
  it('every section is populated (guards against vacuous snapshots)', async () => {
    const json = JSON.stringify((await render({})).tree)
    for (const needle of ['All-Time MVP', 'Golden Boot', 'ChampionsCupCard', 'MastersChampionCard', 'BronzeCard']) {
      expect(json, needle).toContain(needle)
    }
  })
})
