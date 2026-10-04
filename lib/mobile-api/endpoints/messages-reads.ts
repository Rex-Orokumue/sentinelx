import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import type { MobileCtx } from '../auth'
import type { MessageCtx } from '@/lib/messages/service'
import { listThreads, getThreadHeader, listMessages } from '@/lib/messages/read-service'

// The mobile context carries the caller's RLS client as `userClient`; the DM service names it `supabase`.
export function toMessageCtx(ctx: MobileCtx): MessageCtx {
  return { supabase: ctx.userClient, admin: ctx.admin, userId: ctx.userId }
}

const participant = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})

// `kind` is a plain string on the wire so a newer server can add kinds without failing an older app.
const preview = z.object({ kind: z.string(), text: z.string().nullable(), stickerId: z.string().nullable() })

const threadItem = z.object({
  threadId: z.string(),
  other: participant,
  preview,
  lastMessageAt: z.string(),
  unread: z.number(),
})

const messageItem = z.object({
  id: z.string(),
  senderId: z.string(),
  body: z.string().nullable(),
  imageUrl: z.string().nullable(),
  stickerId: z.string().nullable(),
  audioUrl: z.string().nullable(),
  audioDurationSeconds: z.number().nullable(),
  forwarded: z.boolean(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  replyTo: z.object({ id: z.string(), senderName: z.string(), body: z.string().nullable(), removed: z.boolean() }).nullable(),
})

const idParam = { name: 'id', in: 'path' as const, required: true, schema: { type: 'string', format: 'uuid' } }

export const getMessageThreadsEndpoint = defineEndpoint({
  operationId: 'getMessageThreads',
  method: 'GET',
  path: '/messages/threads',
  summary: "One keyset page of the caller's conversations, newest activity first (blocked threads hidden).",
  auth: 'user',
  parameters: [{ name: 'cursor', in: 'query', required: false, schema: { type: 'string' } }],
  response: z.object({ threads: z.array(threadItem), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, req }) => {
    const cursor = new URL(req.url).searchParams.get('cursor') ?? undefined
    return listThreads(toMessageCtx(ctx), { cursor })
  },
})

export const getMessageThreadEndpoint = defineEndpoint({
  operationId: 'getMessageThread',
  method: 'GET',
  path: '/messages/threads/{id}',
  summary: 'Thread header: the other player and who has blocked whom. 404 if the caller is not a participant.',
  auth: 'user',
  parameters: [idParam],
  response: z.object({ threadId: z.string(), other: participant, blockedByMe: z.boolean(), blockedByThem: z.boolean() }),
  handler: async ({ ctx, params }) => {
    const header = await getThreadHeader(toMessageCtx(ctx), params.id)
    if (!header) throw Errors.notFound()
    return header
  },
})

export const getThreadMessagesEndpoint = defineEndpoint({
  operationId: 'getThreadMessages',
  method: 'GET',
  path: '/messages/threads/{id}/messages',
  summary: 'One page of messages, newest first, with signed media URLs and resolved reply previews.',
  auth: 'user',
  parameters: [idParam, { name: 'before', in: 'query', required: false, schema: { type: 'string' } }],
  response: z.object({ messages: z.array(messageItem), nextBefore: z.string().nullable() }),
  handler: async ({ ctx, req, params }) => {
    const before = new URL(req.url).searchParams.get('before') ?? undefined
    const page = await listMessages(toMessageCtx(ctx), params.id, { before })
    if (!page) throw Errors.notFound()
    return page
  },
})
