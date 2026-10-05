import Groq from 'groq-sdk'
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { defineStreamEndpoint } from '../define-stream-endpoint'
import { Errors } from '../errors'
import { fieldErrors } from '../prelude'
import { admitChatTurn } from '@/lib/chat/admission'
import { runChatTurn, type GroqLike } from '@/lib/chat/service'
import { clearChatHistory, listChatHistory } from '@/lib/chat/history'
import { chatBodySchema } from '@/lib/chat/limits'
import { chatEventSchema } from '@/lib/chat/events'
import type { ChatLocale } from '@/lib/chat/types'
import { createAdminClient } from '@/lib/supabase/admin'

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/

export const postChatMessageEndpoint = defineStreamEndpoint({
  operationId: 'postChatMessage',
  path: '/chat/messages',
  summary:
    'Send a support-chat turn and stream the reply. Bearer optional: no Authorization header is signed-out (FAQ only, nothing stored); a present but invalid bearer is 401. Send X-Device-Id (generated once by the app) when signed out.',
  auth: 'public',
  body: chatBodySchema,
  events: chatEventSchema,
  description:
    'NDJSON, one event per line: {"t":"status","state":"checking_account"} | {"t":"delta","text":...} | {"t":"actions","items":[destination...]} | {"t":"done","persisted":bool} | {"t":"error","code":"chat_upstream"|"chat_truncated"|"internal"}. Exactly one terminal event (done or error). Failures before the first byte use the normal JSON error envelope: chat_rate_limited (429, Retry-After and fields.retryAfterSeconds), chat_unavailable (503), validation_failed (400), unauthorized (401).',
  handler: async ({ ctx, body, req, signal }) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const rawDevice = req.headers.get('x-device-id')
    const deviceId = rawDevice && DEVICE_ID.test(rawDevice) ? rawDevice : null
    const admin = createAdminClient()
    const admission = await admitChatTurn(admin, { userId: ctx?.userId ?? null, ip, deviceId })
    if (!admission.ok) {
      throw admission.code === 'chat_rate_limited' ? Errors.chatRateLimited(admission.retryAfterSeconds) : Errors.chatUnavailable()
    }
    if (!process.env.GROQ_API_KEY) throw Errors.chatUnavailable()
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }) as unknown as GroqLike
    return runChatTurn(
      { admin, groq, signal },
      { messages: body.messages, locale: body.locale as ChatLocale, clientTurnId: body.clientTurnId, userId: ctx?.userId ?? null },
    )
  },
})

const historyQuery = z.object({
  before: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const getChatHistoryEndpoint = defineEndpoint({
  operationId: 'getChatHistory',
  method: 'GET',
  path: '/chat/history',
  summary: "The signed-in player's support-chat history within the last 30 days, oldest-first within the page. Cursor-paged with before (an opaque nextBefore); default 40, max 100.",
  auth: 'user',
  parameters: [
    { name: 'before', in: 'query', required: false, description: 'Opaque cursor from a previous nextBefore.', schema: { type: 'string' } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
  ],
  response: z.object({
    messages: z.array(z.object({ id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), createdAt: z.string() })),
    nextBefore: z.string().nullable(),
  }),
  handler: async ({ ctx, req }) => {
    const sp = new URL(req.url).searchParams
    const parsed = historyQuery.safeParse({ before: sp.get('before') ?? undefined, limit: sp.get('limit') ?? undefined })
    if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error))
    return listChatHistory(ctx.admin, ctx.userId, parsed.data)
  },
})

export const deleteChatHistoryEndpoint = defineEndpoint({
  operationId: 'deleteChatHistory',
  method: 'DELETE',
  path: '/chat/history',
  summary: "Delete the signed-in player's entire support-chat history. Naturally idempotent.",
  auth: 'user',
  response: z.object({ ok: z.literal(true) }),
  handler: async ({ ctx }) => {
    await clearChatHistory(ctx.admin, ctx.userId)
    return { ok: true as const }
  },
})
