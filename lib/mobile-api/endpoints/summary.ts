import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { buildMeSummary } from '@/lib/dashboard/summary-service'

const nextMatch = z.object({
  id: z.string(), status: z.string(), round: z.string(), scheduledAt: z.string().nullable(),
  isFullDay: z.boolean(), tournamentTitle: z.string(),
}).nullable()

const banner = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('qualified'), tournamentTitle: z.string(), tournamentSlug: z.string(), round: z.string(), awaitingOpponent: z.boolean() }),
  z.object({ kind: z.literal('eliminated'), tournamentTitle: z.string(), tournamentSlug: z.string(), round: z.string() }),
])

const registration = z.object({ id: z.string(), paymentStatus: z.string(), tournamentTitle: z.string(), tournamentSlug: z.string() })

const nextLobby = z.object({
  lobbyId: z.string(), tournamentTitle: z.string(), stageName: z.string(), roundNo: z.number(),
  label: z.string(), scheduledAt: z.string().nullable(), hasRoomCode: z.boolean(), submitted: z.boolean(),
}).nullable()

const summaryResponse = z.object({
  nextMatch,
  nextLobby,
  hasSubmittableMatch: z.boolean(),
  registrations: z.array(registration),
  banners: z.array(banner),
})

export const summaryEndpoint = defineEndpoint({
  operationId: 'getMeSummary',
  method: 'GET',
  path: '/me/summary',
  summary: 'Dashboard fixtures summary: next fixture, submit-result prompt, active registrations, qualify/eliminate banners.',
  auth: 'user',
  response: summaryResponse,
  handler: async ({ ctx }) => buildMeSummary(ctx.userClient, ctx.userId),
})
