import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import { toMessageCtx } from './messages-reads'
import {
  startConversation,
  sendClientMessage,
  editMessageCore,
  unsendMessageCore,
  forwardMessageCore,
  markThreadRead,
  markAllDelivered,
  blockPlayer,
  unblockPlayer,
  reportThread,
  type Failure,
  type MessageErrorCode,
} from '@/lib/messages/service'

const ok = z.object({ ok: z.literal(true) })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Status per service failure. Codes are passed through as-is: the web already renders these outcomes with the same
// words (the service's `message` is the web action's exact string), so mobile and web stay in step.
const STATUS: Record<MessageErrorCode, number> = {
  not_found: 404,
  validation: 400,
  blocked_by_me: 403,
  blocked: 403,
  messaging_restricted: 403,
  edit_window_closed: 409,
  not_forwardable: 409,
  send_failed: 500,
  action_failed: 500,
  request_pending_limit: 409,
  request_media_not_allowed: 400,
}
function throwFailure(f: Failure): never {
  throw new ApiError(STATUS[f.errorCode], f.errorCode, f.message)
}

function uuidParam(value: string, field: string): string {
  if (!UUID.test(value)) throw Errors.validation({ [field]: 'Invalid id.' })
  return value
}

const idParam = { name: 'id', in: 'path' as const, required: true, schema: { type: 'string', format: 'uuid' } }

export const startMessageThreadEndpoint = defineEndpoint({
  operationId: 'startMessageThread',
  method: 'POST',
  path: '/messages/threads',
  summary: 'Get or create the 1:1 thread with a player. Naturally idempotent.',
  auth: 'user',
  body: z.object({ recipientId: z.string().uuid() }),
  response: z.object({ threadId: z.string() }),
  handler: async ({ ctx, body }) => {
    const res = await startConversation(toMessageCtx(ctx), body.recipientId)
    if (!res.ok) throwFailure(res)
    return { threadId: res.threadId }
  },
})

export const sendMessageEndpoint = defineEndpoint({
  operationId: 'sendMessage',
  method: 'POST',
  path: '/messages/threads/{id}/messages',
  summary: 'Send a text, photo, sticker or voice note. Idempotent: a retried send never creates a second message or push.',
  auth: 'user',
  idempotent: true,
  parameters: [idParam],
  body: z.object({
    body: z.string().max(2000).optional(),
    imagePath: z.string().max(300).optional(),
    stickerId: z.string().max(40).optional(),
    audioPath: z.string().max(300).optional(),
    audioDurationSeconds: z.number().int().positive().max(130).optional(),
    replyToId: z.string().uuid().optional(),
  }),
  response: z.object({ messageId: z.string(), createdAt: z.string() }),
  handler: async ({ ctx, body, params }) => {
    const res = await sendClientMessage(toMessageCtx(ctx), {
      threadId: params.id,
      body: body.body,
      imageUrl: body.imagePath,
      stickerId: body.stickerId,
      audioUrl: body.audioPath,
      audioDurationSeconds: body.audioDurationSeconds,
      replyToId: body.replyToId,
    })
    if (!res.ok) throwFailure(res)
    return { messageId: res.messageId, createdAt: res.createdAt }
  },
})

export const editMessageEndpoint = defineEndpoint({
  operationId: 'editMessage',
  method: 'PATCH',
  path: '/messages/{id}',
  summary: 'Edit your own message within 10 minutes of sending.',
  auth: 'user',
  parameters: [idParam],
  body: z.object({ body: z.string().max(2000) }),
  response: ok,
  handler: async ({ ctx, body, params }) => {
    const res = await editMessageCore(toMessageCtx(ctx), { messageId: params.id, body: body.body })
    if (!res.ok) throwFailure(res)
    return { ok: true as const }
  },
})

export const unsendMessageEndpoint = defineEndpoint({
  operationId: 'unsendMessage',
  method: 'DELETE',
  path: '/messages/{id}',
  summary: 'Unsend your own message within 10 minutes of sending. Naturally idempotent.',
  auth: 'user',
  parameters: [idParam],
  response: ok,
  handler: async ({ ctx, params }) => {
    const res = await unsendMessageCore(toMessageCtx(ctx), params.id)
    if (!res.ok) throwFailure(res)
    return { ok: true as const }
  },
})

export const forwardMessageEndpoint = defineEndpoint({
  operationId: 'forwardMessage',
  method: 'POST',
  path: '/messages/{id}/forward',
  summary: 'Copy a visible message into another of your threads. Idempotent.',
  auth: 'user',
  idempotent: true,
  parameters: [idParam],
  body: z.object({ toThreadId: z.string().uuid() }),
  response: z.object({ messageId: z.string() }),
  handler: async ({ ctx, body, params }) => {
    const res = await forwardMessageCore(toMessageCtx(ctx), { messageId: params.id, toThreadId: body.toThreadId })
    if (!res.ok) throwFailure(res)
    return { messageId: res.messageId }
  },
})

// Receipts never fail the screen: both are best-effort, like the web actions they mirror.
export const markThreadReadEndpoint = defineEndpoint({
  operationId: 'markThreadRead',
  method: 'POST',
  path: '/messages/threads/{id}/read',
  summary: 'Mark a thread read and delivered, and clear its bell rows. Best-effort.',
  auth: 'user',
  parameters: [idParam],
  response: ok,
  handler: async ({ ctx, params }) => {
    try {
      await markThreadRead(toMessageCtx(ctx), params.id)
    } catch {
      // best-effort
    }
    return { ok: true as const }
  },
})

export const markAllDeliveredEndpoint = defineEndpoint({
  operationId: 'markAllDelivered',
  method: 'POST',
  path: '/messages/delivered',
  summary: 'Mark every message addressed to the caller as delivered. Best-effort.',
  auth: 'user',
  response: ok,
  handler: async ({ ctx }) => {
    try {
      await markAllDelivered(toMessageCtx(ctx))
    } catch {
      // best-effort
    }
    return { ok: true as const }
  },
})

const playerIdParam = { name: 'playerId', in: 'path' as const, required: true, schema: { type: 'string', format: 'uuid' } }

export const blockPlayerEndpoint = defineEndpoint({
  operationId: 'blockPlayer',
  method: 'PUT',
  path: '/messages/blocks/{playerId}',
  summary: 'Block a player from messaging you (also severs follows in both directions). Idempotent.',
  auth: 'user',
  parameters: [playerIdParam],
  response: ok,
  handler: async ({ ctx, params }) => {
    const res = await blockPlayer(toMessageCtx(ctx), uuidParam(params.playerId, 'playerId'))
    if (!res.ok) throwFailure(res)
    return { ok: true as const }
  },
})

export const unblockPlayerEndpoint = defineEndpoint({
  operationId: 'unblockPlayer',
  method: 'DELETE',
  path: '/messages/blocks/{playerId}',
  summary: 'Remove a block you placed. Naturally idempotent.',
  auth: 'user',
  parameters: [playerIdParam],
  response: ok,
  handler: async ({ ctx, params }) => {
    const res = await unblockPlayer(toMessageCtx(ctx), uuidParam(params.playerId, 'playerId'))
    if (!res.ok) throwFailure(res)
    return { ok: true as const }
  },
})

export const reportThreadEndpoint = defineEndpoint({
  operationId: 'reportThread',
  method: 'POST',
  path: '/messages/threads/{id}/report',
  summary: 'Report the other player in a thread (optionally citing one message) for staff review.',
  auth: 'user',
  parameters: [idParam],
  body: z.object({ messageId: z.string().uuid().optional(), reason: z.string().max(1000) }),
  response: ok,
  handler: async ({ ctx, body, params }) => {
    const res = await reportThread(toMessageCtx(ctx), { threadId: params.id, messageId: body.messageId, reason: body.reason })
    if (!res.ok) throwFailure(res)
    return { ok: true as const }
  },
})
