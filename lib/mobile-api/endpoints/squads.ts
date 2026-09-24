import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { createAnonClient } from '../anon-client'
import { performCreateSquad, type CreateSquadErrorCode } from '@/lib/tournaments/create-squad-service'
import { performLookupSquad, type LookupSquadErrorCode } from '@/lib/tournaments/lookup-squad-service'
import { squadNameSchema } from '@/lib/tournaments/squad-schema'

const createSquadBody = z.object({ tournamentId: z.string(), name: squadNameSchema })
const createSquadResponse = z.object({ squadId: z.string(), inviteCode: z.string() })

const STATUS: Record<CreateSquadErrorCode, number> = {
  no_username: 400, tournament_not_found: 404, not_squad_tournament: 400, registration_closed: 409,
  already_in_squad: 409, invite_code_failed: 500, name_taken: 409, create_failed: 500,
}
const MESSAGE: Record<CreateSquadErrorCode, string> = {
  no_username: 'Claim a username before creating a squad.',
  tournament_not_found: 'Tournament not found.',
  not_squad_tournament: 'This tournament does not use squads.',
  registration_closed: 'Registration is not open.',
  already_in_squad: "You're already in a squad for this tournament.",
  invite_code_failed: 'Could not create a squad. Please try again.',
  name_taken: 'A squad with that name already exists in this tournament.',
  create_failed: 'Could not create the squad. Please try again.',
}

export const createSquadEndpoint = defineEndpoint({
  operationId: 'postSquads',
  method: 'POST',
  path: '/squads',
  summary: 'Create a squad for a squad-entry tournament and receive its invite code.',
  auth: 'user',
  idempotent: true,
  body: createSquadBody,
  response: createSquadResponse,
  handler: async ({ ctx, body }) => {
    const result = await performCreateSquad(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { squadId: result.squadId, inviteCode: result.inviteCode }
  },
})

const squadPreview = z.object({ id: z.string(), name: z.string(), memberCount: z.number(), teamSize: z.number() })
const lookupSquadResponse = z.object({ squad: squadPreview })

const LOOKUP_STATUS: Record<LookupSquadErrorCode, number> = {
  tournament_not_found: 404, squad_not_found: 404, not_accepting_members: 409, squad_full: 409,
}
const LOOKUP_MESSAGE: Record<LookupSquadErrorCode, string> = {
  tournament_not_found: 'Tournament not found.',
  squad_not_found: 'No squad found for that code.',
  not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
}

export const lookupSquadEndpoint = defineEndpoint({
  operationId: 'getSquadLookup',
  method: 'GET',
  path: '/squads/lookup',
  summary: 'Preview a squad by its invite code before committing to join it.',
  auth: 'public',
  response: lookupSquadResponse,
  handler: async ({ ctx, req }) => {
    const url = new URL(req.url)
    const tournamentId = url.searchParams.get('tournamentId') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const supabase = ctx?.userClient ?? createAnonClient()
    const result = await performLookupSquad(supabase, { tournamentId, code })
    if (!result.ok) throw new ApiError(LOOKUP_STATUS[result.errorCode], result.errorCode, LOOKUP_MESSAGE[result.errorCode])
    return { squad: result.squad }
  },
})
