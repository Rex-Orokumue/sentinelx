import { z } from 'zod'
import { topShowcase } from '@/lib/players/achievement-rarity'
import { AVATAR_BORDER_FRAMES } from '@/lib/store/cosmetics'
import type { PlayerProfileData } from '@/lib/players/service'
import type { PlayerCardData } from '@/components/player/PlayerCard'
import type { FollowListEntry } from '@/lib/follows/query'

const nullableStr = z.string().nullable()

// Every schema is .strict(): a field that is not listed here cannot reach a client, even by accident.
export const publicProfileSchema = z
  .object({
    player: z
      .object({
        id: z.string(),
        username: z.string(),
        displayName: nullableStr,
        avatarUrl: nullableStr,
        frameUrl: nullableStr,
        profileTheme: nullableStr,
        usernameColour: nullableStr,
        country: nullableStr,
        bio: nullableStr,
        createdAt: nullableStr,
        sxScore: z.number(),
        sentinelTier: nullableStr,
        membershipTier: z.string(),
        xp: z.number(),
      })
      .strict(),
    stats: z
      .object({
        totalMatches: z.number(),
        wins: z.number(),
        losses: z.number(),
        goalsScored: z.number(),
        goalsConceded: z.number(),
        totalTitles: z.number(),
        tournamentsPlayed: z.number(),
        currentStreak: z.number(),
        rank: z.number().nullable(),
        totalRankedPlayers: z.number().nullable(),
        followerCount: z.number(),
        followingCount: z.number(),
        categoryStats: z.array(z.object({ category: z.string(), scored: z.number(), conceded: z.number() }).strict()),
      })
      .strict(),
    titles: z.array(
      z.object({ tournamentTitle: z.string(), tournamentSlug: z.string(), gameName: nullableStr, date: nullableStr }).strict(),
    ),
    recentMatches: z.array(
      z
        .object({
          id: z.string(),
          opponentName: z.string(),
          playerScore: z.number(),
          opponentScore: z.number(),
          outcome: z.enum(['win', 'loss', 'draw']),
          tournamentTitle: nullableStr,
          completedAt: nullableStr,
        })
        .strict(),
    ),
    achievements: z
      .object({
        total: z.number(),
        unlockedCount: z.number(),
        unlocked: z.array(
          z
            .object({
              slug: z.string(),
              name: z.string(),
              description: z.string(),
              category: z.string(),
              unlockedAt: z.string(),
              unlockCount: z.number(),
            })
            .strict(),
        ),
        showcase: z.array(z.string()),
      })
      .strict(),
    posts: z.array(z.object({ id: z.string(), content: z.string(), postType: z.string(), createdAt: z.string() }).strict()),
    gallery: z.array(z.object({ id: z.string(), imageUrl: z.string() }).strict()),
  })
  .strict()

export type PublicProfile = z.infer<typeof publicProfileSchema>

export function mapPublicProfile(d: PlayerProfileData): PublicProfile {
  const p = d.profile
  // Filter FIRST and rebuild each object field by field: a locked cell must never be reachable from the output,
  // and no spread means a future field on AchievementCell can never leak by accident. Only counts describe locked ones.
  const unlockedCells = d.achievementCells.filter((c) => c.unlocked)
  // Rarity order = the comparator topShowcase uses (rarest first, ties by most recent unlock), over ALL unlocked.
  const rarityOrdered = topShowcase(d.achievementCells, unlockedCells.length)
  return {
    player: {
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      frameUrl: d.cosmetics.avatarBorder ? (AVATAR_BORDER_FRAMES[d.cosmetics.avatarBorder] ?? null) : null,
      profileTheme: d.cosmetics.profileTheme,
      usernameColour: d.cosmetics.usernameColour,
      country: p.country,
      bio: p.bio,
      createdAt: p.createdAt,
      sxScore: p.sxScore,
      sentinelTier: p.sentinelTier,
      membershipTier: p.membershipTier,
      xp: d.xp,
    },
    stats: {
      totalMatches: p.totalMatches,
      wins: p.wins,
      losses: p.losses,
      goalsScored: p.goalsScored,
      goalsConceded: p.goalsConceded,
      totalTitles: p.totalTitles,
      tournamentsPlayed: p.tournamentsPlayed,
      currentStreak: p.currentStreak,
      rank: p.rank,
      totalRankedPlayers: p.totalRankedPlayers,
      followerCount: p.followerCount,
      followingCount: p.followingCount,
      categoryStats: p.categoryStats.map((c) => ({ category: c.category, scored: c.scored, conceded: c.conceded })),
    },
    titles: d.titles.map((t) => ({
      tournamentTitle: t.tournamentTitle,
      tournamentSlug: t.tournamentSlug,
      gameName: t.gameName,
      date: t.date,
    })),
    recentMatches: d.matches.map((m) => ({
      id: m.id,
      opponentName: m.opponentName,
      playerScore: m.playerScore,
      opponentScore: m.opponentScore,
      outcome: m.outcome,
      tournamentTitle: m.tournamentTitle,
      completedAt: m.completedAt,
    })),
    achievements: {
      total: d.achievementCells.length,
      unlockedCount: unlockedCells.length,
      unlocked: rarityOrdered.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description,
        category: c.category,
        unlockedAt: c.unlockedAt as string,
        unlockCount: c.unlockCount,
      })),
      showcase: topShowcase(d.achievementCells, 3).map((c) => c.slug),
    },
    posts: d.posts.map((x) => ({ id: x.id, content: x.content, postType: x.postType, createdAt: x.createdAt })),
    gallery: d.gallery.map((g) => ({ id: g.id, imageUrl: g.imageUrl })),
  }
}

export const playerListItemSchema = z
  .object({
    username: z.string(),
    displayName: nullableStr,
    avatarUrl: nullableStr,
    sxScore: z.number(),
    sentinelTier: nullableStr,
    membershipTier: z.string(),
    equippedAvatarBorder: nullableStr,
  })
  .strict()

export function mapPlayerListItem(r: PlayerCardData): z.infer<typeof playerListItemSchema> {
  return {
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    sxScore: r.sx_score,
    sentinelTier: r.sentinel_tier,
    membershipTier: r.membership_tier,
    equippedAvatarBorder: r.equipped_avatar_border,
  }
}

export const followEntrySchema = z
  .object({ id: z.string(), username: nullableStr, displayName: nullableStr, avatarUrl: nullableStr, membershipTier: z.string() })
  .strict()

export function mapFollowEntry(e: FollowListEntry): z.infer<typeof followEntrySchema> {
  return { id: e.id, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl, membershipTier: e.membershipTier }
}
