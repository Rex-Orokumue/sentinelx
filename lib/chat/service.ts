/* eslint-disable @typescript-eslint/no-explicit-any -- Groq responses are consumed structurally at this boundary */
import type { createAdminClient } from '@/lib/supabase/admin'
import { buildSystemPrompt } from './system-prompt'
import { CHAT_TOOLS } from './tools'
import { getAccountInfo, unionSections } from './sections'
import { DestinationFilter } from './destinations'
import { stripUnsafeChars } from './text-safety'
import type { ChatEvent, ChatLocale, ChatMessage } from './types'

type Admin = ReturnType<typeof createAdminClient>
export const CHAT_MODEL = 'openai/gpt-oss-120b'
export const CHAT_MAX_OUTPUT_TOKENS = 2000
export const UPSTREAM_TIMEOUT_MS = 20_000

export interface GroqLike {
  chat: { completions: { create(params: Record<string, unknown>, opts?: { signal?: AbortSignal; timeout?: number }): Promise<any> } }
}
export interface ChatTurnInput { messages: ChatMessage[]; locale: ChatLocale; clientTurnId: string | null; userId: string | null }
export interface ChatTurnDeps { admin: Admin; groq: GroqLike; signal?: AbortSignal }

async function persistTurn(admin: Admin, userId: string, turnId: string | null, userText: string, assistantText: string, startedAt: string): Promise<boolean> {
  try {
    const { error } = await admin.from('chat_messages').insert([
      { player_id: userId, role: 'user', content: userText, client_turn_id: turnId, created_at: startedAt },
      { player_id: userId, role: 'assistant', content: assistantText, client_turn_id: turnId, created_at: new Date().toISOString() },
    ] as never)
    if (!error) return true
    return (error as { code?: string }).code === '23505' // a retry of an already-stored turn
  } catch {
    return false
  }
}

// One chat turn as a stream of events. Exactly one terminal event (done | error) unless the signal aborted,
// in which case the generator just returns. Nothing is persisted on error or abort.
export async function* runChatTurn(deps: ChatTurnDeps, input: ChatTurnInput): AsyncGenerator<ChatEvent> {
  const { admin, groq, signal } = deps
  const startedAt = new Date().toISOString()
  const opts = { signal, timeout: UPSTREAM_TIMEOUT_MS }
  const common = { model: CHAT_MODEL, reasoning_effort: 'low', max_completion_tokens: CHAT_MAX_OUTPUT_TOKENS }
  const system = { role: 'system', content: buildSystemPrompt({ isLoggedIn: !!input.userId, locale: input.locale }) }
  const base = [system, ...input.messages]

  let first: any
  try {
    first = await groq.chat.completions.create(
      { ...common, messages: base, ...(input.userId ? { tools: CHAT_TOOLS, tool_choice: 'auto' } : {}) },
      opts,
    )
  } catch {
    if (signal?.aborted) return
    yield { t: 'error', code: 'chat_upstream' }
    return
  }
  const choice = first?.choices?.[0]
  if (!choice) { yield { t: 'error', code: 'chat_upstream' }; return }
  if (choice.finish_reason === 'length') { yield { t: 'error', code: 'chat_truncated' }; return }

  const filter = new DestinationFilter()
  let full = ''
  const toText = (raw: string) => { const t = filter.push(stripUnsafeChars(raw)); full += t; return t }

  const toolCalls: any[] = choice.message?.tool_calls ?? []
  if (toolCalls.length > 0 && input.userId) {
    yield { t: 'status', state: 'checking_account' }
    const sections = unionSections(toolCalls.map((c) => c?.function?.arguments ?? ''))
    const info = await getAccountInfo(admin, input.userId, sections) // id from the SESSION, never the model
    let stream: AsyncIterable<any>
    try {
      stream = await groq.chat.completions.create(
        {
          ...common,
          stream: true,
          messages: [...base, choice.message, ...toolCalls.map((c) => ({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(info) }))],
        },
        opts,
      )
    } catch {
      if (signal?.aborted) return
      yield { t: 'error', code: 'chat_upstream' }
      return
    }
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) return
        const c = chunk?.choices?.[0]
        if (c?.finish_reason === 'length') { yield { t: 'error', code: 'chat_truncated' }; return }
        const text = toText(c?.delta?.content ?? '')
        if (text) yield { t: 'delta', text }
      }
    } catch {
      if (signal?.aborted) return
      yield { t: 'error', code: 'chat_upstream' }
      return
    }
  } else {
    const text = toText(choice.message?.content ?? '')
    if (text) yield { t: 'delta', text }
  }

  if (signal?.aborted) return
  const tail = filter.flush()
  if (tail) { full += tail; yield { t: 'delta', text: tail } }
  if (full.trim() === '') { yield { t: 'error', code: 'chat_upstream' }; return }
  const items = filter.destinations()
  if (items.length > 0) yield { t: 'actions', items }

  const persisted = input.userId
    ? await persistTurn(admin, input.userId, input.clientTurnId, input.messages[input.messages.length - 1].content, full, startedAt)
    : false
  yield { t: 'done', persisted }
}
