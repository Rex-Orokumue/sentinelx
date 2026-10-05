/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes for the groq + supabase surfaces */
import { describe, it, expect, vi } from 'vitest'
import { runChatTurn, type GroqLike } from './service'

async function collect(gen: AsyncGenerator<unknown>) { const out: any[] = []; for await (const e of gen) out.push(e); return out }
function stream(parts: Array<{ text?: string; finish?: string }>) {
  return (async function* () { for (const p of parts) yield { choices: [{ delta: { content: p.text }, finish_reason: p.finish ?? null }] } })()
}
function groq(first: any, second?: any): GroqLike {
  const create = vi.fn().mockResolvedValueOnce(first)
  if (second) create.mockResolvedValueOnce(second)
  return { chat: { completions: { create } } }
}
const plain = (content: string, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] })
function inserts() {
  const rows: any[] = []
  const admin = { from: () => ({ insert: (r: any) => { rows.push(...r); return Promise.resolve({ error: null }) } }) } as never
  return { admin, rows }
}
const base = { messages: [{ role: 'user' as const, content: 'how do fees work' }], locale: 'en' as const, clientTurnId: 't1', userId: null }
const toolCall = (args: string) => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_account_info', arguments: args } }] }, finish_reason: 'tool_calls' }] })

describe('runChatTurn', () => {
  it('no tool: flushes one delta then done', async () => {
    const { admin } = inserts()
    const ev = await collect(runChatTurn({ admin, groq: groq(plain('Entry is ₦500.')) }, base))
    expect(ev).toEqual([{ t: 'delta', text: 'Entry is ₦500.' }, { t: 'done', persisted: false }])
  })
  it('signed-out never offers tools', async () => {
    const { admin } = inserts()
    const g = groq(plain('x'))
    await collect(runChatTurn({ admin, groq: g }, base))
    expect((g.chat.completions.create as any).mock.calls[0][0].tools).toBeUndefined()
  })
  it('sends reasoning_effort low and the output cap', async () => {
    const { admin } = inserts()
    const g = groq(plain('x'))
    await collect(runChatTurn({ admin, groq: g }, base))
    expect((g.chat.completions.create as any).mock.calls[0][0]).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 2000 })
  })
  it('strips destination tokens from deltas and emits actions before done', async () => {
    const { admin } = inserts()
    const ev = await collect(runChatTurn({ admin, groq: groq(plain('See {{go:rules}} please')) }, base))
    expect(ev.map((e) => e.t)).toEqual(['delta', 'actions', 'done'])
    expect(JSON.stringify(ev)).not.toContain('{{')
    expect(ev[1]).toEqual({ t: 'actions', items: ['rules'] })
  })
  it('finish_reason length is a chat_truncated error and persists nothing', async () => {
    const { admin, rows } = inserts()
    const ev = await collect(runChatTurn({ admin, groq: groq(plain('', 'length')) }, { ...base, userId: 'u1' }))
    expect(ev).toEqual([{ t: 'error', code: 'chat_truncated' }])
    expect(rows).toHaveLength(0)
  })
  it('upstream failure is a chat_upstream error', async () => {
    const { admin } = inserts()
    const g: GroqLike = { chat: { completions: { create: vi.fn().mockRejectedValue(new Error('503')) } } }
    expect(await collect(runChatTurn({ admin, groq: g }, base))).toEqual([{ t: 'error', code: 'chat_upstream' }])
  })
  it('tool turn: status, only requested sections queried with the SESSION user id, streamed deltas, persisted pair', async () => {
    const { admin, rows } = inserts()
    const first = toolCall('{"sections":["kyc"],"playerId":"victim"}')
    const g = groq(first, stream([{ text: 'You are ' }, { text: 'verified.', finish: 'stop' }]))
    const dbAdmin = { from: (t: string) => (t === 'chat_messages' ? (admin as any).from() : { select: () => ({ eq: (_c: string, v: string) => { expect(v).toBe('u1'); return { maybeSingle: async () => ({ data: { kyc_status: 'verified' }, error: null }) } } }) }) } as never
    const ev = await collect(runChatTurn({ admin: dbAdmin, groq: g }, { ...base, userId: 'u1' }))
    expect(ev[0]).toEqual({ t: 'status', state: 'checking_account' })
    expect(ev.filter((e) => e.t === 'delta').map((e) => e.text).join('')).toBe('You are verified.')
    expect(ev[ev.length - 1]).toEqual({ t: 'done', persisted: true })
    expect(rows.map((r) => [r.role, r.client_turn_id])).toEqual([['user', 't1'], ['assistant', 't1']])
    expect(new Date(rows[0].created_at).getTime()).toBeLessThanOrEqual(new Date(rows[1].created_at).getTime())
  })
  it('the tool result sent back to the model carries only the requested section', async () => {
    const { admin } = inserts()
    const g = groq(toolCall('{"sections":["kyc"]}'), stream([{ text: 'ok', finish: 'stop' }]))
    const dbAdmin = { from: (t: string) => (t === 'chat_messages' ? (admin as any).from() : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { kyc_status: 'verified' }, error: null }) }) }) }) } as never
    await collect(runChatTurn({ admin: dbAdmin, groq: g }, { ...base, userId: 'u1' }))
    const second = (g.chat.completions.create as any).mock.calls[1][0]
    const toolMsg = second.messages.find((m: any) => m.role === 'tool')
    expect(JSON.parse(toolMsg.content)).toEqual({ kyc: { status: 'verified' } })
    expect(second.tools).toBeUndefined()
  })
  it('abort mid-stream persists nothing and ends without a terminal event', async () => {
    const { admin, rows } = inserts()
    const ac = new AbortController()
    const first = toolCall('{"sections":["score"]}')
    const g = groq(first, (async function* () { yield { choices: [{ delta: { content: 'a' }, finish_reason: null }] }; ac.abort(); yield { choices: [{ delta: { content: 'b' }, finish_reason: 'stop' }] } })())
    const dbAdmin = { from: (t: string) => (t === 'chat_messages' ? (admin as any).from() : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { sx_score: 700 }, error: null }) }) }) }) } as never
    const ev = await collect(runChatTurn({ admin: dbAdmin, groq: g, signal: ac.signal }, { ...base, userId: 'u1' }))
    expect(ev.some((e) => e.t === 'done' || e.t === 'error')).toBe(false)
    expect(ev.some((e) => e.t === 'delta' && e.text.includes('b'))).toBe(false) // nothing is forwarded after the abort
    expect(rows).toHaveLength(0)
  })
  it('the abort signal is handed to the upstream calls', async () => {
    const { admin } = inserts()
    const ac = new AbortController()
    const g = groq(plain('x'))
    await collect(runChatTurn({ admin, groq: g, signal: ac.signal }, base))
    expect((g.chat.completions.create as any).mock.calls[0][1].signal).toBe(ac.signal)
  })
  it('a duplicate clientTurnId (unique violation) still reports persisted: true', async () => {
    const admin = { from: () => ({ insert: () => Promise.resolve({ error: { code: '23505', message: 'dup' } }) }) } as never
    const ev = await collect(runChatTurn({ admin, groq: groq(plain('hi')) }, { ...base, userId: 'u1' }))
    expect(ev[ev.length - 1]).toEqual({ t: 'done', persisted: true })
  })
  it('a persistence failure after a streamed reply is done persisted:false, never an error', async () => {
    const admin = { from: () => ({ insert: () => Promise.resolve({ error: { code: '500', message: 'down' } }) }) } as never
    const ev = await collect(runChatTurn({ admin, groq: groq(plain('hi')) }, { ...base, userId: 'u1' }))
    expect(ev[ev.length - 1]).toEqual({ t: 'done', persisted: false })
  })
  it('an empty reply is a chat_upstream error', async () => {
    const { admin } = inserts()
    expect(await collect(runChatTurn({ admin, groq: groq(plain('')) }, base))).toEqual([{ t: 'error', code: 'chat_upstream' }])
  })
  it('unsafe characters in the reply are stripped before they reach the client or storage', async () => {
    const { admin, rows } = inserts()
    const ev = await collect(runChatTurn({ admin, groq: groq(plain('hi‮there')) }, { ...base, userId: 'u1' }))
    expect(ev[0]).toEqual({ t: 'delta', text: 'hithere' })
    expect(rows[1].content).toBe('hithere')
  })
})
