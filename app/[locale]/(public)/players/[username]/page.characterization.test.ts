import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_NOW } from '@/lib/testing/progress-fixtures'
import {
  PROFILE_TABLES, PROFILE_RPC, OWNER_ID, OWNER_USERNAME, TARGET_ID, TARGET_USERNAME, THIRD_ID, THIRD_USERNAME,
  DELETED_USERNAME, OWNER_COIN_BALANCE, LOCKED_ONLY_ACHIEVEMENT_NAMES,
} from '@/lib/testing/profile-fixtures'

type Fake = ReturnType<typeof fakeSupabase>
const state = vi.hoisted(() => ({ fake: null as unknown, admin: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => (state.fake as Fake).client }))
// Owner-only coin balance + the season standing read go through the admin client.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => (state.admin as Fake).client }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
// Friendship + DM state is viewer-only and not part of what 3b extracts (mobile drops Friend/Message buttons).
vi.mock('@/lib/messages/query', () => ({ fetchProfileMessagingState: async () => undefined }))

import PlayerProfilePage from './page'

async function render(username: string, user: { id: string } | null) {
  const fake = fakeSupabase(PROFILE_TABLES, { user, rpc: PROFILE_RPC })
  const admin = fakeSupabase(PROFILE_TABLES)
  state.fake = fake
  state.admin = admin
  const tree = await PlayerProfilePage({ params: { username } })
  return { tree: serializeTree(tree), queries: fake.queries, adminQueries: admin.queries }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXTURE_NOW))
})
afterEach(() => vi.useRealTimers())

describe('player profile page — characterization (pins current behavior; must not change during extraction)', () => {
  it('anonymous visitor', async () => {
    const r = await render(TARGET_USERNAME, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
    expect(r.adminQueries).toMatchSnapshot('adminQueries')
  })

  it('signed-in visitor who follows the target', async () => {
    const r = await render(TARGET_USERNAME, { id: OWNER_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })

  it('signed-in visitor who does not follow the profile', async () => {
    const r = await render(OWNER_USERNAME, { id: THIRD_ID })
    expect(r.tree).toMatchSnapshot('tree')
  })

  it('profile that follows the viewer back ("follows you")', async () => {
    const r = await render(THIRD_USERNAME, { id: TARGET_ID })
    expect(r.tree).toMatchSnapshot('tree')
  })

  it('owner sees the owner-only coin balance and season standing', async () => {
    const r = await render(OWNER_USERNAME, { id: OWNER_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
    expect(r.adminQueries).toMatchSnapshot('adminQueries')
    expect(JSON.stringify(r.tree)).toContain(String(OWNER_COIN_BALANCE))
  })

  it('unknown username → 404', async () => {
    await expect(render('nobody', null)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('deleted account → 404', async () => {
    await expect(render(DELETED_USERNAME, null)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a player with both locked and unlocked achievements: the DATA layer holds every locked cell', async () => {
    // Web hides locked ones only in rendered HTML (AchievementsGrid is not executed by serializeTree), so the props
    // still carry every locked name — the hazard a JSON API must not inherit (spec §4).
    const json = JSON.stringify((await render(TARGET_USERNAME, null)).tree)
    for (const name of LOCKED_ONLY_ACHIEVEMENT_NAMES) expect(json).toContain(name)
    expect(json).toContain('"unlocked":false')
    expect(json).toContain('"unlocked":true')
  })

  it('fixtures exercise the interesting paths (guards against a vacuous snapshot)', async () => {
    const json = JSON.stringify((await render(TARGET_USERNAME, null)).tree)
    expect(json).toContain('TBD') // null opponent embed
    expect(json).toContain('Bravo Squad') // team match
    expect(json).toContain('Masters Cup') // a title
    expect(json).toContain('https://cdn.test/c2.jpg') // gallery
    expect(json).not.toContain('deleted post') // is_deleted filter applied
  })
})
