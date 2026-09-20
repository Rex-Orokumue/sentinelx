import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { recordDailyLogin, type DailyLoginResult } from '@/lib/login/actions'

const dailyLoginResponse = z.object({
  awardedToday: z.boolean(),
  coinsAwarded: z.number(),
  xpAwarded: z.number(),
  streak: z.number(),
  milestone: z.enum(['week', 'month']).nullable(),
})

const sessionStartResponse = z.object({
  dailyLogin: dailyLoginResponse,
  deletionRequestedAt: z.string().nullable(),
})

export function toSessionStartResponse(result: DailyLoginResult) {
  const { deletionRequestedAt, ...dailyLogin } = result
  return { dailyLogin, deletionRequestedAt }
}

export const sessionStartEndpoint = defineEndpoint({
  operationId: 'postSessionStart',
  method: 'POST',
  path: '/session/start',
  summary: 'Runs login()\'s server-side side-effects (daily login coins/XP/streak) and reports deletion-pending status. Call once per app process after a session exists — not on every screen visit.',
  auth: 'user',
  response: sessionStartResponse,
  handler: async ({ ctx }) => {
    // ctx.admin: deletion_requested_at is a private column (S1) and is not
    // readable through ctx.userClient — same reasoning as GET /me.
    const result = await recordDailyLogin(ctx.admin, ctx.userId)
    return toSessionStartResponse(result)
  },
})
