import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { loadBracketView } from '@/lib/tournaments/bracket-view'

const standingRow = z.object({
  playerId: z.string(), name: z.string(), clubName: z.string().nullable().optional(),
  played: z.number(), wins: z.number(), draws: z.number(), losses: z.number(),
  goalsFor: z.number(), goalsAgainst: z.number(), goalDiff: z.number(), points: z.number(),
  rank: z.number(), advancing: z.boolean(),
})
const bracketMatch = z.object({
  id: z.string(), round: z.string(), group_id: z.string().nullable(), groupName: z.string().nullable(),
  status: z.string(), score_a: z.number().nullable(), score_b: z.number().nullable(),
  scheduled_at: z.string().nullable(), is_full_day: z.boolean(),
  playerA: z.object({ id: z.string(), name: z.string() }),
  playerB: z.object({ id: z.string(), name: z.string() }),
})
const fixtureSplit = z.object({
  live: z.array(bracketMatch), upcoming: z.array(bracketMatch),
  completed: z.array(bracketMatch), disputedOrCancelled: z.array(bracketMatch),
})
const knockoutRound = z.object({ round: z.string(), label: z.string(), matches: z.array(bracketMatch) })
const projectedRound = z.object({ round: z.string(), label: z.string(), matchCount: z.number() })
const nameRef = z.object({ id: z.string(), name: z.string() }).nullable()

const bracketResponse = z.object({
  standings: z.array(z.object({ groupId: z.string(), groupName: z.string(), rows: z.array(standingRow) })),
  fixtures: fixtureSplit,
  rounds: z.array(knockoutRound),
  projected: z.array(projectedRound),
  champion: nameRef,
  thirdPlace: nameRef,
  thirdPlaceMatch: bracketMatch.nullable(),
  hasGroups: z.boolean(),
  hasKnockout: z.boolean(),
})

export const bracketEndpoint = defineEndpoint({
  operationId: 'getTournamentBracket',
  method: 'GET',
  path: '/tournaments/{id}/bracket',
  summary: 'Group standings, fixtures, and knockout rounds for one tournament.',
  auth: 'public',
  response: bracketResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { data: t } = await supabase.from('tournaments').select('format').eq('id', params.id).maybeSingle()
    if (!t) throw Errors.notFound()
    return loadBracketView(supabase, params.id, t.format)
  },
})
