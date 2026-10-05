import { describe, it, expect } from 'vitest'
import { chatBodySchema, clampHistory, MAX_HISTORY_MESSAGES } from './limits'
import { chatEventSchema } from './events'

const turn = '11111111-1111-4111-8111-111111111111'
describe('chatBodySchema', () => {
  it('accepts a normal body and defaults locale to en', () => {
    const r = chatBodySchema.safeParse({ messages: [{ role: 'user', content: 'hi' }], clientTurnId: turn })
    expect(r.success && r.data.locale).toBe('en')
  })
  it('rejects: last message not user, over-long message, >20 messages, >8000 chars total, system role', () => {
    const bad = (messages: unknown) => chatBodySchema.safeParse({ messages, clientTurnId: turn }).success
    expect(bad([{ role: 'assistant', content: 'x' }])).toBe(false)
    expect(bad([{ role: 'user', content: 'x'.repeat(1001) }])).toBe(false)
    expect(bad(Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })))).toBe(false)
    expect(bad(Array.from({ length: 9 }, () => ({ role: 'user', content: 'x'.repeat(1000) })))).toBe(false)
    expect(bad([{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }])).toBe(false)
  })
  it('allows a long earlier assistant reply (up to 4000) but not beyond', () => {
    const ok = (n: number) => chatBodySchema.safeParse({ messages: [{ role: 'assistant', content: 'a'.repeat(n) }, { role: 'user', content: 'q' }], clientTurnId: turn }).success
    expect(ok(4000)).toBe(true)
    expect(ok(4001)).toBe(false)
  })
  it('rejects a non-uuid clientTurnId and an unknown locale', () => {
    const m = [{ role: 'user', content: 'hi' }]
    expect(chatBodySchema.safeParse({ messages: m, clientTurnId: 'nope' }).success).toBe(false)
    expect(chatBodySchema.safeParse({ messages: m, clientTurnId: turn, locale: 'de' }).success).toBe(false)
  })
})
describe('clampHistory (lenient, for the web route)', () => {
  it('keeps the newest messages within the count and total caps and truncates per role (user 1000, assistant 4000)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: 'y'.repeat(5000) }))
    const out = clampHistory(many)
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES)
    expect(out.every((m) => m.content.length <= (m.role === 'user' ? 1000 : 4000))).toBe(true)
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(8000)
  })
})
describe('chatEventSchema', () => {
  it('accepts each event shape and rejects an unknown destination or error code', () => {
    expect(chatEventSchema.safeParse({ t: 'status', state: 'checking_account' }).success).toBe(true)
    expect(chatEventSchema.safeParse({ t: 'delta', text: 'x' }).success).toBe(true)
    expect(chatEventSchema.safeParse({ t: 'actions', items: ['wallet'] }).success).toBe(true)
    expect(chatEventSchema.safeParse({ t: 'done', persisted: true }).success).toBe(true)
    expect(chatEventSchema.safeParse({ t: 'actions', items: ['evil'] }).success).toBe(false)
    expect(chatEventSchema.safeParse({ t: 'error', code: 'boom' }).success).toBe(false)
  })
})
