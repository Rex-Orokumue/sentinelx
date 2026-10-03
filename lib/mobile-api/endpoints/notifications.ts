import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import {
  PUSH_PREF_KEYS, WHATSAPP_PREF_KEYS, SHARING_PREF_KEYS, patchPrefsSchema,
} from '@/lib/notifications/prefs'
import { getPrefs, patchPrefs } from '@/lib/notifications/prefs-service'
import { clearPostMute, clearTypeMute, listMutes, setPostMute, setTypeMute } from '@/lib/notifications/mute-service'
import { markAllRead, markRead } from '@/lib/notifications/inbox-service'
import { sendTestPushToPlayer } from '@/lib/notifications/test-push-service'

const bools = <K extends string>(keys: readonly K[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>)

const prefsResponse = z.object({
  push: bools(PUSH_PREF_KEYS),
  whatsapp: bools(WHATSAPP_PREF_KEYS),
  achievementSharing: bools(SHARING_PREF_KEYS),
})
const ok = z.object({ ok: z.literal(true) })

export const getNotificationPrefsEndpoint = defineEndpoint({
  operationId: 'getNotificationPrefs',
  method: 'GET',
  path: '/notifications/prefs',
  summary:
    'Effective notification preferences (push 17, WhatsApp 6, achievement sharing 5). An absent stored key resolves to its default; a type muted "always" shows as push[type] = false.',
  auth: 'user',
  response: prefsResponse,
  handler: async ({ ctx }) => getPrefs(ctx.admin, ctx.userId),
})

export const patchNotificationPrefsEndpoint = defineEndpoint({
  operationId: 'patchNotificationPrefs',
  method: 'PATCH',
  path: '/notifications/prefs',
  summary:
    'Merge-patch any subset of the preference sections; each present section is merged atomically. Unknown keys or non-booleans are rejected. Returns the full effective prefs.',
  auth: 'user',
  body: patchPrefsSchema,
  response: prefsResponse,
  handler: async ({ ctx, body }) => patchPrefs(ctx.admin, ctx.userId, body),
})

const duration = z.enum(['1h', '1w', 'always'])
// status_removed is a moderation notice that is always delivered; only the 17 user-toggleable keys can be muted.
const muteType = z.enum(PUSH_PREF_KEYS)

const muteBody = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('type'), type: muteType, duration }),
  z.object({ scope: z.literal('post'), postId: z.string().uuid(), duration }),
])
const unmuteBody = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('type'), type: muteType }),
  z.object({ scope: z.literal('post'), postId: z.string().uuid() }),
])

export const getNotificationMutesEndpoint = defineEndpoint({
  operationId: 'getNotificationMutes',
  method: 'GET',
  path: '/notifications/mutes',
  summary:
    'Live (unexpired) timed mutes. A type muted "always" is not listed here; it is push[type] = false in the prefs.',
  auth: 'user',
  response: z.object({
    types: z.array(z.object({ type: z.string(), mutedUntil: z.string() })),
    posts: z.array(z.object({ postId: z.string(), mutedUntil: z.string() })),
  }),
  handler: async ({ ctx }) => listMutes(ctx.admin, ctx.userId),
})

export const postNotificationMuteEndpoint = defineEndpoint({
  operationId: 'postNotificationMute',
  method: 'POST',
  path: '/notifications/mutes',
  summary:
    'Mute a notification type or a post thread for 1h, 1w or always. "always" for a type flips push[type] = false (and clears any timed row); "always" for a post is a far-future expiry.',
  auth: 'user',
  body: muteBody,
  response: ok,
  handler: async ({ ctx, body }) => {
    const result =
      body.scope === 'type'
        ? await setTypeMute(ctx.admin, ctx.userId, body.type, body.duration)
        : await setPostMute(ctx.admin, ctx.userId, body.postId, body.duration)
    if (!result.ok) throw new Error('mute failed')
    return { ok: true as const }
  },
})

export const deleteNotificationMuteEndpoint = defineEndpoint({
  operationId: 'deleteNotificationMute',
  method: 'DELETE',
  path: '/notifications/mutes',
  summary: 'Unmute a type (clears the timed row and any "always" flag) or a post thread. Naturally idempotent.',
  auth: 'user',
  body: unmuteBody,
  response: ok,
  handler: async ({ ctx, body }) => {
    if (body.scope === 'type') await clearTypeMute(ctx.admin, ctx.userId, body.type)
    else await clearPostMute(ctx.admin, ctx.userId, body.postId)
    return { ok: true as const }
  },
})

export const postNotificationReadEndpoint = defineEndpoint({
  operationId: 'postNotificationRead',
  method: 'POST',
  path: '/notifications/{id}/read',
  summary: 'Mark one of your notifications read. Already read is a success; an unknown or someone else’s id is 404.',
  auth: 'user',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  response: ok,
  handler: async ({ ctx, params }) => {
    if (!z.string().uuid().safeParse(params.id).success) throw Errors.notFound()
    if ((await markRead(ctx.admin, ctx.userId, params.id)) === 'not_found') throw Errors.notFound()
    return { ok: true as const }
  },
})

export const postNotificationsReadAllEndpoint = defineEndpoint({
  operationId: 'postNotificationsReadAll',
  method: 'POST',
  path: '/notifications/read-all',
  summary: 'Mark all of your unread notifications read; returns how many were updated.',
  auth: 'user',
  response: z.object({ updated: z.number().int().nonnegative() }),
  handler: async ({ ctx }) => ({ updated: await markAllRead(ctx.admin, ctx.userId) }),
})

export const postTestPushEndpoint = defineEndpoint({
  operationId: 'postTestPush',
  method: 'POST',
  path: '/notifications/test-push',
  summary:
    'Send a clearly labelled test push to your own registered devices through the real sender. 404 if you have no registered device; 500 if nothing could be delivered.',
  auth: 'user',
  response: ok,
  handler: async ({ ctx }) => {
    if ((await sendTestPushToPlayer(ctx.admin, ctx.userId)) === 'no_device') throw Errors.notFound()
    return { ok: true as const }
  },
})
