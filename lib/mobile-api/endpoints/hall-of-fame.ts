import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { getHallOfFame } from '@/lib/hall-of-fame/service'
import { CATEGORY_META } from '@/lib/games/categories'
import type { ChampionEntry } from '@/lib/tournaments/champions'
import { hallOfFameResponseSchema, mapPlayerCard } from './progress-schemas'

function mapChampion(entry: ChampionEntry) {
  return {
    tournamentId: entry.tournamentId, slug: entry.slug, title: entry.title,
    tournamentType: entry.tournamentType, gameId: entry.gameId, gameName: entry.gameName,
    date: entry.date, prizePool: entry.prizePool,
    champion: { id: entry.champion.id, name: entry.champion.name },
    runnerUp: entry.runnerUp ? { id: entry.runnerUp.id, name: entry.runnerUp.name } : null,
    championAvatarUrl: entry.championAvatarUrl, seasonName: entry.seasonName,
  }
}

export const hallOfFameEndpoint = defineEndpoint({
  operationId: 'getHallOfFame', method: 'GET', path: '/hall-of-fame',
  summary: 'Public Hall of Fame awards, champions by tier, and bronze finishes with optional game filter.',
  auth: 'public', cacheControl: 'public, s-maxage=300, stale-while-revalidate=600', response: hallOfFameResponseSchema,
  handler: async ({ req }) => {
    const gameSlug = new URL(req.url).searchParams.get('game')?.trim() || null
    const hall = await getHallOfFame(createAnonClient(), { gameSlug })
    const mapOption = (option: typeof hall.goldenBootOptions[number]) => ({
      gameId: option.gameId, gameLabel: option.gameLabel,
      winner: option.winner ? mapPlayerCard(option.winner) : null, metricValue: option.metricValue,
    })
    return {
      games: hall.activeGameList.map((game) => ({
        id: game.id, slug: game.slug, name: game.name, category: game.category,
      })),
      selectedGame: hall.selectedGame?.slug ?? null,
      awards: {
        mvp: hall.mvp ? mapPlayerCard(hall.mvp) : null,
        goldenBoot: hall.goldenBootOptions.map(mapOption),
        categories: hall.categoryAwards.map((award) => ({
          category: award.category, label: CATEGORY_META[award.category].awardName,
          metricLabel: CATEGORY_META[award.category].statLabel.toLowerCase(),
          options: award.options.map(mapOption),
        })),
      },
      champions: {
        championsCup: hall.championGroups.champions_cup.map(mapChampion),
        masters: hall.championGroups.masters.map(mapChampion),
        communityClub: hall.championGroups.community_club.map(mapChampion),
        open: hall.championGroups.open.map(mapChampion),
      },
      bronze: hall.thirdPlaces.map((entry) => ({
        tournamentId: entry.tournamentId, slug: entry.slug, title: entry.title,
        gameName: entry.gameName, date: entry.date,
        player: { id: entry.player.id, name: entry.player.name },
      })),
    }
  },
})
