// Support chatbot, web transport. The turn itself (prompting, the section-scoped account tool, destination tokens,
// persistence) lives in lib/chat/service.ts and is shared with the mobile /api/mobile/v1/chat/messages endpoint; this
// route only identifies the caller, admits the turn, and flattens the event stream to the plain-text protocol the web
// ChatTab has always read. See docs/superpowers/specs/2026-10-05-mobile-phase5c-guide-and-chatbot-design.md.
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import Groq from 'groq-sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeHistory } from '@/lib/chat/sanitize-history'
import { clampHistory } from '@/lib/chat/limits'
import { admitChatTurn } from '@/lib/chat/admission'
import { runChatTurn, type GroqLike } from '@/lib/chat/service'
import { CHAT_LOCALES, type ChatLocale } from '@/lib/chat/types'

export const runtime = 'nodejs'
// Worst case is two sequential 20 s upstream calls plus account reads.
export const maxDuration = 60

const ANON_COOKIE = 'sx-chat-anon-id'
const FALLBACK = 'Having trouble responding right now — try again shortly.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  let body: { messages?: unknown; locale?: unknown; clientTurnId?: unknown }
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const history = clampHistory(sanitizeHistory(body.messages))
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return new NextResponse('Bad payload', { status: 400 })
  }
  const locale: ChatLocale = (CHAT_LOCALES as readonly unknown[]).includes(body.locale) ? (body.locale as ChatLocale) : 'en'
  const clientTurnId = typeof body.clientTurnId === 'string' && UUID.test(body.clientTurnId) ? body.clientTurnId : null

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Anonymous identity cookie, set on first request if absent. Used only as one rate-limit bucket (hashed in
  // admission), never linked to stored content: anonymous chats are never persisted.
  let anonId = req.cookies.get(ANON_COOKIE)?.value ?? null
  const isNewAnonId = !user && !anonId
  if (isNewAnonId) anonId = randomUUID()
  const withCookie = (res: NextResponse) => {
    if (isNewAnonId && anonId) res.cookies.set(ANON_COOKIE, anonId, { httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
    return res
  }

  const admin = createAdminClient()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  let admission
  try {
    admission = await admitChatTurn(admin, { userId: user?.id ?? null, ip, deviceId: user ? null : anonId })
  } catch {
    // e.g. CHAT_HASH_PEPPER not configured: fail closed rather than serving unmetered chat.
    return withCookie(new NextResponse('Support chat is unavailable right now. Please try again later.', { status: 503 }))
  }
  if (!admission.ok) {
    return withCookie(
      admission.code === 'chat_rate_limited'
        ? new NextResponse('Too many messages — please wait a few minutes and try again.', { status: 429 })
        : new NextResponse('Support chat is unavailable right now. Please try again later.', { status: 503 }),
    )
  }
  if (!process.env.GROQ_API_KEY) {
    return withCookie(new NextResponse('Support chat is unavailable right now. Please try again later.', { status: 503 }))
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }) as unknown as GroqLike
  const ac = new AbortController()
  req.signal?.addEventListener('abort', () => ac.abort())
  const turn = runChatTurn({ admin, groq, signal: ac.signal }, { messages: history, locale, clientTurnId, userId: user?.id ?? null })

  const encoder = new TextEncoder()
  const iterator = turn[Symbol.asyncIterator]()
  let sentText = false
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A pull that enqueues nothing is never called again, so keep reading until a chunk is produced
        // (status, actions and done have no representation in the plain-text protocol) or the turn ends.
        for (;;) {
          const { value, done } = await iterator.next()
          if (done) { controller.close(); return }
          if (value.t === 'delta') {
            sentText = true
            controller.enqueue(encoder.encode(value.text))
            return
          }
          if (value.t === 'error' && !sentText) {
            controller.enqueue(encoder.encode(FALLBACK))
            return
          }
        }
      } catch {
        try {
          if (!sentText) controller.enqueue(encoder.encode(FALLBACK))
          controller.close()
        } catch {}
      }
    },
    cancel() {
      ac.abort()
      void Promise.resolve(iterator.return?.(undefined as never)).catch(() => {})
    },
  })
  return withCookie(new NextResponse(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
}
