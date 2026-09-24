import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { stageStanding } from '@/lib/tournaments/stage-standing'

const pointsStandingRow = z.object({
  entrantId: z.string(), displayName: z.string(), played: z.number(),
  totalPoints: z.number(), totalKills: z.number(),
  bestPlacement: z.number().nullable(), lastRoundPlacement: z.number().nullable(),
  rank: z.number(), advancing: z.boolean(), unresolvedTieWith: z.array(z.string()),
})
const standingsResponse = z.object({ rows: z.array(pointsStandingRow) })

export const standingsEndpoint = defineEndpoint({
  operationId: 'getTournamentStandings',
  method: 'GET',
  path: '/tournaments/{id}/standings',
  summary: 'Points-race stage standings (round-robin/BR). Group standings live in GET /tournaments/{id}/bracket instead.',
  auth: 'public',
  response: standingsResponse,
  handler: async ({ req, params }) => {
    const stageId = new URL(req.url).searchParams.get('stage')
    if (!stageId) throw Errors.validation({ stage: 'A stage query parameter is required.' })
    const admin = createAdminClient()
    const { data: stage } = await admin
      .from('tournament_stages')
      .select('id, advance_count, tournament_id')
      .eq('id', stageId)
      .eq('tournament_id', params.id)
      .maybeSingle()
    if (!stage) throw Errors.notFound()
    const rows = await stageStanding(admin, { id: stage.id, advance_count: stage.advance_count })
    return { rows }
  },
})
