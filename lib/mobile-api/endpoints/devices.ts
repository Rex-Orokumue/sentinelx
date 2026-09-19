import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'

type Admin = MobileCtx['admin']

const deviceBody = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(40),
})
const tokenBody = z.object({ token: z.string().min(20).max(4096) })

// Service role on purpose, exactly like app/api/notifications/fcm-token/route.ts: one physical
// device carries its FCM token across accounts, and a second account's upsert would otherwise
// trip fcm_tokens_owner's USING clause (42501) permanently. player_id comes from the verified
// token, never the body, so a caller can only ever claim a token FOR THEMSELVES.
export async function registerDevice(admin: Admin, userId: string, body: z.infer<typeof deviceBody>): Promise<void> {
  const { error } = await admin.from('fcm_tokens').upsert(
    {
      player_id: userId,
      token: body.token,
      platform: body.platform,
      app_version: body.appVersion,
      last_active: new Date().toISOString(),
    },
    { onConflict: 'token' },
  )
  if (error) {
    console.error('[mobile-api/devices] upsert failed', { userId, code: (error as { code?: string }).code, message: error.message })
    throw new Error('device registration failed')
  }
}

export async function unregisterDevice(admin: Admin, userId: string, token: string): Promise<void> {
  await admin.from('fcm_tokens').delete().eq('token', token).eq('player_id', userId)
}

const ok = z.object({ ok: z.literal(true) })

export const registerDeviceEndpoint = defineEndpoint({
  operationId: 'postDevice',
  method: 'POST',
  path: '/devices',
  summary: 'Register (or move to this account) this device’s native FCM token.',
  auth: 'user',
  body: deviceBody,
  response: ok,
  handler: async ({ ctx, body }) => {
    await registerDevice(ctx.admin, ctx.userId, body)
    return { ok: true as const }
  },
})

export const unregisterDeviceEndpoint = defineEndpoint({
  operationId: 'deleteDevice',
  method: 'DELETE',
  path: '/devices',
  summary: 'Unregister this device’s token (call before sign-out).',
  auth: 'user',
  body: tokenBody,
  response: ok,
  handler: async ({ ctx, body }) => {
    await unregisterDevice(ctx.admin, ctx.userId, body.token)
    return { ok: true as const }
  },
})
