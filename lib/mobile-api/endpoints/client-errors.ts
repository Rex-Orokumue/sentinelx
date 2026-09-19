import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'

const errorBodySchema = z.object({
  message: z.string().min(1).max(20000),
  stack: z.string().max(40000).optional(),
  route: z.string().max(500).optional(),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(40),
  locale: z.string().max(10).optional(),
})
type ErrorBody = z.infer<typeof errorBodySchema>

// Reuses public.client_error_logs (same table the web error boundaries write) so staff see
// mobile crashes in the same place. Platform/version ride in user_agent; no schema change.
export function buildErrorRow(body: ErrorBody, userId: string | null) {
  return {
    user_id: userId,
    message: body.message.slice(0, 4000),
    stack: body.stack?.slice(0, 8000) ?? null,
    digest: null,
    url: body.route ?? null,
    user_agent: `sentinelx-mobile/${body.appVersion} (${body.platform})`,
    locale: body.locale ?? null,
  }
}

export const errorsEndpoint = defineEndpoint({
  operationId: 'postClientError',
  method: 'POST',
  path: '/errors',
  summary: 'Report an app crash/exception into client_error_logs. Works signed-out. Never fails the caller.',
  auth: 'public', // a crash on the login screen is exactly what we need to see
  skipVersionGate: true, // outdated apps must still be able to report why they broke
  body: errorBodySchema,
  response: z.object({ ok: z.literal(true) }),
  handler: async ({ ctx, body }) => {
    try {
      const admin = ctx?.admin ?? (await import('@/lib/supabase/admin')).createAdminClient()
      await admin.from('client_error_logs').insert(buildErrorRow(body, ctx?.userId ?? null))
    } catch {
      // Logging must never fail the caller — same rule as lib/errors/actions.ts.
    }
    return { ok: true as const }
  },
})
