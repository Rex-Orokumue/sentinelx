import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { fetchChampions } from '@/lib/tournaments/champions'
import { isClosedWithoutWinner } from '@/lib/tournaments/no-winner'

const placing = z.object({ id: z.string(), name: z.string() })
const championEntry = z.object({
  tournamentId: z.string(),
  slug: z.string(),
  title: z.string(),
  tournamentType: z.enum(['champions_cup', 'masters', 'community_club', 'open']),
  gameId: z.string(),
  gameName: z.string(),
  date: z.string().nullable(),
  prizePool: z.number().nullable(),
  champion: placing,
  runnerUp: placing.nullable(),
  championAvatarUrl: z.string().nullable(),
  seasonName: z.string().nullable(),
})

const resultsResponse = z.object({
  champion: championEntry.nullable(),
  noWinner: z.boolean(),
})

export const resultsEndpoint = defineEndpoint({
  operationId: 'getTournamentResults',
  method: 'GET',
  path: '/tournaments/{id}/results',
  summary: 'Champion (if resolved) and no-winner status for a completed tournament.',
  auth: 'public',
  response: resultsResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { data: t } = await supabase.from('tournaments').select('id, status').eq('id', params.id).maybeSingle()
    if (!t) throw Errors.notFound()
    if (t.status !== 'completed') return { champion: null, noWinner: false }

    const champions = await fetchChampions(supabase, { tournamentId: t.id })
    const champion = champions[0] ?? null
    let noWinner = false
    if (!champion) {
      const { data: finalRows } = await supabase.from('matches').select('round, status').eq('tournament_id', t.id).eq('round', 'final')
      noWinner = isClosedWithoutWinner(t.status, finalRows ?? [])
    }
    return { champion, noWinner }
  },
})
