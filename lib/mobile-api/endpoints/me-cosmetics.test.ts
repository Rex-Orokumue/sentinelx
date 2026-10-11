import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))

import { meEndpoint, meResponse, toMeResponse } from './me'

const ctx = { userId: 'u1', email: 'a@b.c', roles: [], isStaff: false, isAdmin: false } as never
const row = {
  username: 'ada', display_name: 'Ada', avatar_url: null, whatsapp_number: null, country: null, locale: 'en',
  membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null, profile_completed_at: null as string | null,
  consent_whatsapp_updates: false,
}

describe('toMeResponse cosmetics (additive)', () => {
  it('carries the equipped username colour and profile theme slugs', () => {
    const p = toMeResponse(ctx, row, [], { usernameColour: 'username_gold', profileTheme: 'theme_neon_grid' }).profile
    expect(p).toMatchObject({ usernameColour: 'username_gold', profileTheme: 'theme_neon_grid' })
    expect(meResponse.safeParse(toMeResponse(ctx, row, [], { usernameColour: 'username_gold', profileTheme: null })).success).toBe(true)
  })

  it('defaults both to null when nothing is passed', () => {
    const p = toMeResponse(ctx, row, []).profile
    expect(p).toMatchObject({ usernameColour: null, profileTheme: null })
  })
})

describe('GET /me cosmetics', () => {
  const item = (slug: string, category: string, equipped: boolean, player_id = 'u1') => ({
    player_id, item_id: `id-${slug}`, equipped, store_items: { slug, category },
  })

  function call(rows: ReturnType<typeof item>[]) {
    const { client } = fakeSupabase({ profiles: [{ id: 'u1', ...row }], game_interest: [], player_store_items: rows })
    authenticate.mockResolvedValue({ ...(ctx as object), admin: client })
    return meEndpoint.handler(new Request('https://x.test/api/mobile/v1/me'))
  }

  beforeEach(() => authenticate.mockReset())

  it("returns the caller's equipped colour and theme, ignoring unequipped items and other players' rows", async () => {
    const res = await call([
      item('username_gold', 'username_colour', true),
      item('username_red', 'username_colour', false),
      item('theme_neon_grid', 'profile_theme', true),
      item('theme_dark_void', 'profile_theme', true, 'stranger'),
      item('avatar_border_bronze', 'avatar_border', true),
    ])
    expect(res.status).toBe(200)
    expect((await res.json()).data.profile).toMatchObject({ usernameColour: 'username_gold', profileTheme: 'theme_neon_grid' })
  })

  it('returns null for both when nothing is equipped', async () => {
    const res = await call([item('username_gold', 'username_colour', false)])
    expect((await res.json()).data.profile).toMatchObject({ usernameColour: null, profileTheme: null })
  })
})
