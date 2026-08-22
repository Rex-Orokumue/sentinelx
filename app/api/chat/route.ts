// Support Chatbot — see docs/superpowers/specs/2026-08-22-support-chatbot-design.md.
// Two-phase Groq flow: a non-streamed decision call, then — only when it
// requested the account-snapshot tool — a streamed synthesis call (the
// slower phase, so it's the one that benefits from streaming). No-tool
// answers are sent as a single flush through the same stream interface the
// client always reads, so the client protocol is uniform either way.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import Groq from 'groq-sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeHistory, type ChatMessage } from '@/lib/chat/sanitize-history'
import { checkAndRecordRateLimit } from '@/lib/chat/rate-limit'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'
import { CHAT_TOOLS } from '@/lib/chat/tools'
import { getAccountSnapshot } from '@/lib/chat/account-snapshot'

export const runtime = 'nodejs'

const MODEL = 'llama-3.3-70b-versatile'
const ANON_COOKIE = 'sx-chat-anon-id'

type Admin = ReturnType<typeof createAdminClient>

// Best-effort — never throws into the response path, matching
// lib/notifications/notify.ts's convention for non-blocking side writes. A
// failed history write must never surface to the user or affect the reply
// they already received (spec §7).
async function persistChatTurn(admin: Admin, playerId: string, userContent: string, assistantContent: string): Promise<void> {
  try {
    await admin.from('chat_messages').insert([
      { player_id: playerId, role: 'user', content: userContent },
      { player_id: playerId, role: 'assistant', content: assistantContent },
    ])
  } catch {
    // best-effort — swallow
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const history = sanitizeHistory(body.messages)
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Anonymous identity cookie — set on first request if absent. Used only
  // as a rate-limit subject key, never linked to stored chat content
  // (anonymous chats are never persisted — Global Constraints).
  let anonId = req.cookies.get(ANON_COOKIE)?.value ?? null
  const isNewAnonId = !user && !anonId
  if (isNewAnonId) anonId = randomUUID()
  const subjectKey = user ? `player:${user.id}` : `anon:${anonId}`

  const admin = createAdminClient()
  const rateLimit = await checkAndRecordRateLimit(admin, subjectKey)
  if (!rateLimit.ok) {
    const res = new NextResponse('Too many messages — please wait a few minutes and try again.', { status: 429 })
    if (isNewAnonId && anonId) res.cookies.set(ANON_COOKIE, anonId, { httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
    return res
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const systemPrompt = buildSystemPrompt(!!user)
  const baseMessages: ChatMessage[] = history

  let firstCompletion
  try {
    firstCompletion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: systemPrompt }, ...baseMessages],
      tools: user ? CHAT_TOOLS : undefined,
      tool_choice: user ? 'auto' : undefined,
    })
  } catch {
    return new NextResponse('Upstream error', { status: 502 })
  }

  const firstMessage = firstCompletion.choices[0].message
  const toolCalls = firstMessage.tool_calls

  let stream: AsyncIterable<Groq.Chat.ChatCompletionChunk> | null = null
  let finalText = firstMessage.content ?? ''

  if (toolCalls && toolCalls.length > 0 && user) {
    // Only get_account_snapshot exists — execute it once regardless of how
    // many calls the model made, ignoring any model-supplied arguments
    // (Global Constraints: always the real session's player_id).
    const snapshot = await getAccountSnapshot(admin, user.id)
    const toolResultMessages = toolCalls.map((tc) => ({
      role: 'tool' as const,
      tool_call_id: tc.id,
      content: JSON.stringify(snapshot),
    }))

    try {
      stream = await groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...baseMessages,
          firstMessage as unknown as Groq.Chat.ChatCompletionMessageParam, // SDK response-message type vs request-param type — standard round-trip friction in OpenAI-style SDKs
          ...toolResultMessages,
        ],
        stream: true,
      })
      finalText = ''
    } catch {
      return new NextResponse('Upstream error', { status: 502 })
    }
  }

  const encoder = new TextEncoder()
  const lastUserMessage = baseMessages[baseMessages.length - 1].content

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullReply = finalText
      try {
        if (stream) {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? ''
            if (delta) {
              fullReply += delta
              controller.enqueue(encoder.encode(delta))
            }
          }
        } else if (finalText) {
          controller.enqueue(encoder.encode(finalText))
        }
      } catch {
        if (!fullReply) {
          fullReply = 'Having trouble responding right now — try again shortly.'
          controller.enqueue(encoder.encode(fullReply))
        }
      } finally {
        controller.close()
        if (user) void persistChatTurn(admin, user.id, lastUserMessage, fullReply)
      }
    },
  })

  const res = new NextResponse(responseStream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  if (isNewAnonId && anonId) res.cookies.set(ANON_COOKIE, anonId, { httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
  return res
}
