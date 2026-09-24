import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { PROFILE_TABLES, TARGET_USERNAME, TARGET_ID, DELETED_USERNAME } from '@/lib/testing/profile-fixtures'

type Fake = ReturnType<typeof fakeSupabase>
const state = vi.hoisted(() => ({ fake: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => (state.fake as Fake).client }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import FollowersPage from './page'
import FollowingPage from '../following/page'

type Page = (a: { params: { username: string } }) => Promise<unknown>

async function render(page: Page, username: string, user: { id: string } | null, tables = PROFILE_TABLES) {
  const fake = fakeSupabase(tables, { user })
  state.fake = fake
  const tree = await page({ params: { username } })
  return { tree: serializeTree(tree as never), queries: fake.queries }
}

const noFollows = { ...PROFILE_TABLES, player_follows: [] }

describe('followers page — characterization (pins current behavior; must not change during extraction)', () => {
  it('anonymous', async () => {
    const r = await render(FollowersPage, TARGET_USERNAME, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('signed in: "Follows you" ids come from fetchFollowerIds(viewer)', async () => {
    const r = await render(FollowersPage, TARGET_USERNAME, { id: TARGET_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('empty list renders the empty state', async () => {
    const r = await render(FollowersPage, TARGET_USERNAME, null, noFollows)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('unknown → 404, deleted → 404', async () => {
    await expect(render(FollowersPage, 'nobody', null)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(render(FollowersPage, DELETED_USERNAME, null)).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('following page — characterization', () => {
  it('anonymous', async () => {
    const r = await render(FollowingPage, TARGET_USERNAME, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('signed in', async () => {
    const r = await render(FollowingPage, TARGET_USERNAME, { id: TARGET_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('empty list renders the empty state', async () => {
    const r = await render(FollowingPage, TARGET_USERNAME, null, noFollows)
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('unknown → 404, deleted → 404', async () => {
    await expect(render(FollowingPage, 'nobody', null)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(render(FollowingPage, DELETED_USERNAME, null)).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('lists the people the target follows (fixture guards against a vacuous snapshot)', async () => {
    const json = JSON.stringify((await render(FollowingPage, TARGET_USERNAME, null)).tree)
    expect(json).toContain('player3')
  })
})
