import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { buildHomeSummary, mapTournamentCard, mapLeaderboardRow } from '@/lib/home/summary'

const tournamentCard = z.object({
  id: z.string(), title: z.string(), slug: z.string(), prizePool: z.number(), registrationFee: z.number(),
  status: z.string(), tournamentStart: z.string().nullable(), registrationEnd: z.string().nullable(),
  tournamentEnd: z.string().nullable(), maxPlayers: z.number().nullable(), format: z.string().nullable(),
  tournamentType: z.string().nullable(), cardImageUrl: z.string().nullable(),
  game: z.object({ name: z.string(), iconUrl: z.string().nullable(), slug: z.string().nullable(), category: z.string().nullable() }).nullable(),
})

const leaderboardPlayer = z.object({
  id: z.string(), username: z.string().nullable(), displayName: z.string().nullable(), avatarUrl: z.string().nullable(),
  wins: z.number(), totalMatches: z.number(), sxScore: z.number(), sentinelTier: z.string().nullable(),
  membershipTier: z.string().nullable(), equippedAvatarBorder: z.string().nullable(),
})

const homeResponse = z.object({
  banner: z.object({ title: z.string(), imageUrl: z.string(), linkUrl: z.string() }).nullable(),
  featuredTournament: tournamentCard.nullable(),
  upcomingTournaments: z.array(tournamentCard),
  leaderboardTeaser: z.array(leaderboardPlayer),
  hallOfFame: z.object({
    slug: z.string(), title: z.string(), prizePool: z.number(), gameName: z.string().nullable(), championName: z.string(),
  }).nullable(),
  stats: z.object({ playerCount: z.number(), tournamentCount: z.number(), prizesPaidOut: z.number() }),
})

export const homeEndpoint = defineEndpoint({
  operationId: 'getHome',
  method: 'GET',
  path: '/home',
  summary: 'Home: banners, live/upcoming tournaments, leaderboard teaser, hall-of-fame teaser, platform stats. Public — visible logged out, same as the web home page.',
  auth: 'public',
  cacheControl: 'public, s-maxage=30, stale-while-revalidate=120',
  response: homeResponse,
  handler: async () => {
    const summary = await buildHomeSummary(createAnonClient())
    return {
      ...summary,
      featuredTournament: summary.featuredTournament ? mapTournamentCard(summary.featuredTournament) : null,
      upcomingTournaments: summary.upcomingTournaments.map(mapTournamentCard),
      leaderboardTeaser: summary.leaderboardTeaser.map(mapLeaderboardRow),
    }
  },
})
