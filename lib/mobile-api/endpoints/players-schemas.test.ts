import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, PROFILE_RPC, TARGET_USERNAME } from '@/lib/testing/profile-fixtures'
import { getPlayerProfile } from '@/lib/players/service'
import {
  mapPublicProfile, publicProfileSchema, mapPlayerListItem, playerListItemSchema, mapFollowEntry, followEntrySchema,
} from './players-schemas'

async function mapped() {
  const sb = fakeSupabase(PROFILE_TABLES, { rpc: PROFILE_RPC }).client as never
  const admin = fakeSupabase(PROFILE_TABLES).client as never
  const data = (await getPlayerProfile(sb, () => admin, TARGET_USERNAME, null))!
  return { data, out: publicProfileSchema.parse(mapPublicProfile(data)) }
}

describe('mapPublicProfile — locked achievements never leave the server', () => {
  it('the serialized body contains no locked achievement name, description or slug', async () => {
    const { data, out } = await mapped()
    const body = JSON.stringify(out)
    const locked = data.achievementCells.filter((c) => !c.unlocked)
    expect(locked.length).toBeGreaterThan(0) // guard: the fixture really has locked ones
    for (const c of locked) {
      expect(body).not.toContain(c.name)
      expect(body).not.toContain(c.description)
      expect(body).not.toContain(c.slug)
    }
  })

  it('sends only counts for locked ones', async () => {
    const { data, out } = await mapped()
    expect(out.achievements.total).toBe(data.achievementCells.length)
    expect(out.achievements.unlockedCount).toBe(2)
    expect(out.achievements.unlocked).toHaveLength(2)
  })

  it('unlocked list is in rarity order (rarest first) and showcase is the top-3 subset', async () => {
    const { out } = await mapped()
    expect(out.achievements.unlocked.map((a) => a.slug)).toEqual(['champion', 'first-blood'])
    expect(out.achievements.showcase).toEqual(['champion', 'first-blood'])
    expect(out.achievements.showcase.length).toBeLessThanOrEqual(3)
  })

  it('ties on rarity break by most recent unlock, exactly like the web showcase', async () => {
    const { data } = await mapped()
    const cells = data.achievementCells.map((c) =>
      c.slug === 'first-blood' ? { ...c, unlockCount: 1 } : c,
    )
    const out = mapPublicProfile({ ...data, achievementCells: cells })
    // both unlockCount 1 now; champion was unlocked later (2026-09-20 vs 2026-08-01)
    expect(out.achievements.unlocked.map((a) => a.slug)).toEqual(['champion', 'first-blood'])
  })
})

describe('mapPublicProfile — shape', () => {
  it('has exactly the documented top-level and nested keys', async () => {
    const { out } = await mapped()
    expect(Object.keys(out).sort()).toEqual(['achievements', 'gallery', 'player', 'posts', 'recentMatches', 'stats', 'titles'])
    expect(Object.keys(out.player).sort()).toEqual([
      'avatarUrl', 'bio', 'country', 'createdAt', 'displayName', 'frameUrl', 'id', 'membershipTier',
      'profileTheme', 'sentinelTier', 'sxScore', 'username', 'usernameColour', 'xp',
    ])
    expect(Object.keys(out.stats).sort()).toEqual([
      'categoryStats', 'currentStreak', 'followerCount', 'followingCount', 'goalsConceded', 'goalsScored',
      'losses', 'rank', 'totalMatches', 'totalRankedPlayers', 'totalTitles', 'tournamentsPlayed', 'wins',
    ])
    expect(Object.keys(out.achievements).sort()).toEqual(['showcase', 'total', 'unlocked', 'unlockedCount'])
    expect(Object.keys(out.achievements.unlocked[0]).sort()).toEqual(['category', 'description', 'name', 'slug', 'unlockCount', 'unlockedAt'])
    expect(Object.keys(out.recentMatches[0]).sort()).toEqual(['completedAt', 'id', 'opponentName', 'opponentScore', 'outcome', 'playerScore', 'tournamentTitle'])
    expect(Object.keys(out.titles[0]).sort()).toEqual(['date', 'gameName', 'tournamentSlug', 'tournamentTitle'])
    expect(Object.keys(out.posts[0]).sort()).toEqual(['content', 'createdAt', 'id', 'postType'])
    expect(Object.keys(out.gallery[0]).sort()).toEqual(['id', 'imageUrl'])
  })

  it('resolves the equipped frame to art and exposes the equipped cosmetic slugs', async () => {
    const { out } = await mapped()
    expect(out.player.frameUrl).toBe('/coin-items/purple-glow.webp')
    expect(out.player.profileTheme).toBeNull()
    expect(out.player.usernameColour).toBeNull()
  })

  it('includes the public xp (the web shows XP progress to every visitor) but never owner-only data', async () => {
    const { out } = await mapped()
    expect(out.player.xp).toBe(1500)
    const body = JSON.stringify(out).toLowerCase()
    for (const k of ['phone', 'whatsapp', 'notification_prefs', 'referred', 'deletion', 'coinbalance', 'monthly', 'follows_viewer', 'isfollowing']) {
      expect(body).not.toContain(k)
    }
  })

  it('the strict schema rejects an extra key at every level', async () => {
    const { out } = await mapped()
    expect(() => publicProfileSchema.parse({ ...out, viewerFollows: true })).toThrow()
    expect(() => publicProfileSchema.parse({ ...out, player: { ...out.player, phone: '1' } })).toThrow()
    expect(() => publicProfileSchema.parse({ ...out, achievements: { ...out.achievements, locked: [] } })).toThrow()
  })
})

describe('list mappers', () => {
  it('mapPlayerListItem: exact keys', () => {
    const out = playerListItemSchema.parse(
      mapPlayerListItem({ username: 'a', display_name: 'A', avatar_url: null, sx_score: 800, sentinel_tier: 'trusted', membership_tier: 'guardian', equipped_avatar_border: null, phone: 'x' } as never),
    )
    expect(Object.keys(out).sort()).toEqual(['avatarUrl', 'displayName', 'equippedAvatarBorder', 'membershipTier', 'sentinelTier', 'sxScore', 'username'])
  })

  it('mapFollowEntry: exact keys', () => {
    const out = followEntrySchema.parse(
      mapFollowEntry({ id: 'p1', username: 'a', displayName: 'A', avatarUrl: null, membershipTier: 'recruit' }),
    )
    expect(Object.keys(out).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'membershipTier', 'username'])
  })
})
