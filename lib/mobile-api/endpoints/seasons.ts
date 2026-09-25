import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { Errors } from '../errors'
import { getSeasonBySlug, getSeasonSections, listSeasons } from '@/lib/seasons/service'
import { seasonDetailResponseSchema, seasonListResponseSchema } from './progress-schemas'

function mapSeason(s: { id: string; slug: string; name: string; start_date: string; end_date: string }) {
  return { id: s.id, slug: s.slug, name: s.name, startDate: s.start_date, endDate: s.end_date }
}

export const seasonsListEndpoint = defineEndpoint({
  operationId: 'getSeasons', method: 'GET', path: '/seasons', summary: 'All seasons, newest first.',
  auth: 'public', cacheControl: 'public, s-maxage=300, stale-while-revalidate=600', response: seasonListResponseSchema,
  handler: async () => ({ seasons: (await listSeasons(createAnonClient())).map(mapSeason) }),
})

export const seasonDetailEndpoint = defineEndpoint({
  operationId: 'getSeasonDetail', method: 'GET', path: '/seasons/{slug}',
  summary: 'One season with per-game tournaments, provisional-aware standings and tier labels.',
  auth: 'public', cacheControl: 'public, s-maxage=60, stale-while-revalidate=300', response: seasonDetailResponseSchema,
  handler: async ({ req }) => {
    const slug = decodeURIComponent(new URL(req.url).pathname.split('/').filter(Boolean).at(-1) ?? '')
    const anon = createAnonClient()
    const season = await getSeasonBySlug(anon, slug)
    if (!season) throw Errors.notFound()
    const [sections, { data: gameRows }] = await Promise.all([
      getSeasonSections(anon, createAdminClient(), season.id),
      anon.from('games').select('id, slug'),
    ])
    const slugById = new Map((gameRows ?? []).map((g) => [g.id, g.slug]))
    return {
      season: mapSeason(season),
      games: sections.map((game) => ({
        gameId: game.gameId, gameName: game.gameName, gameSlug: slugById.get(game.gameId) ?? '',
        tournaments: game.tournaments.map((t) => ({
          id: t.id, title: t.title, slug: t.slug, tournamentType: t.tournament_type,
          status: t.status, tournamentStart: t.tournament_start, invitationOnly: t.invitation_only,
        })),
        leaderboard: game.leaderboard.map((row) => ({
          playerId: row.playerId, username: row.username, displayName: row.displayName,
          avatarUrl: row.avatarUrl, sxScore: row.sxScore, points: row.points, isProvisional: row.isProvisional,
        })),
        tierLabels: {
          communityClub: game.tierLabels.communityClub, masters: game.tierLabels.masters,
          qualificationNote: game.tierLabels.qualificationNote,
          showChampionsCupSpotlight: game.tierLabels.showChampionsCupSpotlight,
        },
      })),
    }
  },
})
