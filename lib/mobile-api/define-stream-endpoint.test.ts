/* eslint-disable @typescript-eslint/no-explicit-any -- the endpoint factory is exercised through loose test doubles */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const getUser = vi.fn()
const rolesEq = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: rolesEq }) }) })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ __admin: true }) }))

import { defineStreamEndpoint } from './define-stream-endpoint'
import { ApiError } from './errors'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  getUser.mockReset()
  rolesEq.mockReset()
})

const ev = z.discriminatedUnion('t', [z.object({ t: z.literal('delta'), text: z.string() }), z.object({ t: z.literal('done') })])
const mk = (handler: any, auth: 'public' | 'user' = 'public') =>
  defineStreamEndpoint({ operationId: 'postT', path: '/t', summary: 's', auth, body: z.object({ q: z.string() }), events: ev, description: 'd', handler })
const post = (ep: any, headers: Record<string, string> = {}, body: unknown = { q: 'x' }) =>
  ep.handler(new Request('https://x.test/api/mobile/v1/t', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
async function lines(res: Response) { return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)) }

describe('defineStreamEndpoint', () => {
  it('streams one JSON object per line with ndjson headers', async () => {
    const ep = mk(async () => (async function* () { yield { t: 'delta', text: 'hi' }; yield { t: 'done' } })())
    const res = await post(ep)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await lines(res)).toEqual([{ t: 'delta', text: 'hi' }, { t: 'done' }])
  })
  it('errors thrown by the handler BEFORE streaming use the normal JSON envelope, status and Retry-After', async () => {
    const ep = mk(async () => { throw new ApiError(429, 'chat_rate_limited', 'slow', { retryAfterSeconds: '30' }) })
    const res = await post(ep)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(await res.json()).toEqual({ error: { code: 'chat_rate_limited', message: 'slow', fields: { retryAfterSeconds: '30' } } })
  })
  it('an invalid body is validation_failed 400', async () => {
    const ep = mk(async () => (async function* () {})())
    const res = await post(ep, {}, { q: 1 })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
  })
  it('a too-old app version is 426 before anything runs', async () => {
    vi.stubEnv('MOBILE_MIN_APP_VERSION', '2.0.0')
    const handler = vi.fn()
    const res = await post(mk(handler), { 'x-app-version': '1.0.0' })
    expect(res.status).toBe(426)
    expect(handler).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
  it('no Authorization header is signed-out: ctx is null', async () => {
    const handler = vi.fn(async (_input?: any) => (async function* () { yield { t: 'done' } })())
    await (await post(mk(handler))).text()
    expect(handler.mock.calls[0][0].ctx).toBeNull()
  })
  it('a present-but-bad bearer is 401, never anonymous, and the handler never runs', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } })
    const handler = vi.fn(async (_input?: any) => (async function* () { yield { t: 'done' } })())
    const res = await post(mk(handler), { authorization: 'Bearer garbage' })
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })
  it('auth: user without a bearer is 401', async () => {
    const res = await post(mk(async () => (async function* () {})(), 'user'))
    expect(res.status).toBe(401)
  })
  it('an event that violates the schema becomes a terminal internal error line, not a crash', async () => {
    const ep = mk(async () => (async function* () { yield { t: 'delta', text: 5 } as never })())
    const out = await lines(await post(ep))
    expect(out[out.length - 1]).toEqual({ t: 'error', code: 'internal' })
  })
  it('a generator that throws mid-stream ends with a terminal internal error line', async () => {
    const ep = mk(async () => (async function* () { yield { t: 'delta', text: 'a' }; throw new Error('boom') })())
    const out = await lines(await post(ep))
    expect(out).toEqual([{ t: 'delta', text: 'a' }, { t: 'error', code: 'internal' }])
  })
  it('cancelling the body aborts the handler signal and lets the generator finish', async () => {
    const finalized = vi.fn()
    let sig: AbortSignal | undefined
    const ep = mk(async ({ signal }: { signal: AbortSignal }) => {
      sig = signal
      return (async function* () {
        try {
          yield { t: 'delta', text: 'a' }
          await new Promise<void>((res) => signal.addEventListener('abort', () => res()))
        } finally { finalized() }
      })()
    })
    const res = await post(ep)
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await new Promise((r) => setTimeout(r, 0))
    expect(sig!.aborted).toBe(true)
    expect(finalized).toHaveBeenCalled()
  })
  it('cancelling while the generator is idle at a yield still runs its finally', async () => {
    const finalized = vi.fn()
    const ep = mk(async () => (async function* () { try { yield { t: 'delta', text: 'a' }; yield { t: 'delta', text: 'b' } } finally { finalized() } })())
    const res = await post(ep)
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    await new Promise((r) => setTimeout(r, 0))
    expect(finalized).toHaveBeenCalled()
  })
})
