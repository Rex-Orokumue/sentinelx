import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('./auth', () => ({ authenticate, optionalAuth }))

import { defineEndpoint } from './define-endpoint'
import { Errors } from './errors'

const ctx = (over: Record<string, unknown> = {}) => ({ userId: 'u1', isStaff: false, isAdmin: false, ...over })
const call = (ep: { handler: (r: Request) => Promise<Response> }, init?: RequestInit, headers: Record<string, string> = {}) =>
  ep.handler(new Request('https://x.test/api/mobile/v1/t', { ...init, headers: { 'content-type': 'application/json', ...headers } }))

beforeEach(() => {
  authenticate.mockReset()
  optionalAuth.mockReset()
  vi.unstubAllEnvs()
})

const echo = defineEndpoint({
  operationId: 'postEcho', method: 'POST', path: '/echo', summary: 'echo', auth: 'user',
  body: z.object({ name: z.string().min(2, 'name_too_short') }),
  response: z.object({ hello: z.string() }),
  handler: async ({ ctx, body }) => ({ hello: `${body.name}:${ctx.userId}` }),
})

describe('defineEndpoint', () => {
  it('wraps a successful result in {data} with the api version header', async () => {
    authenticate.mockResolvedValue(ctx())
    const res = await call(echo, { method: 'POST', body: JSON.stringify({ name: 'Ada' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-api-version')).toBe('1')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ data: { hello: 'Ada:u1' } })
  })

  it('returns 401 when authentication fails', async () => {
    authenticate.mockRejectedValue(Errors.unauthorized())
    const res = await call(echo, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('unauthorized')
  })

  it('returns 400 with per-field codes for a bad body', async () => {
    authenticate.mockResolvedValue(ctx())
    const res = await call(echo, { method: 'POST', body: JSON.stringify({ name: 'A' }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', message: 'Some fields are invalid.', fields: { name: 'name_too_short' } },
    })
  })

  it('returns 400 for a non-JSON body instead of crashing', async () => {
    authenticate.mockResolvedValue(ctx())
    const res = await call(echo, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('enforces staff and admin levels with 403', async () => {
    const staffOnly = defineEndpoint({
      operationId: 'getS', method: 'GET', path: '/s', summary: 's', auth: 'staff',
      response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    authenticate.mockResolvedValue(ctx({ isStaff: false }))
    expect((await call(staffOnly)).status).toBe(403)
    authenticate.mockResolvedValue(ctx({ isStaff: true }))
    expect((await call(staffOnly)).status).toBe(200)

    const adminOnly = defineEndpoint({
      operationId: 'getA', method: 'GET', path: '/a', summary: 'a', auth: 'admin',
      response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    authenticate.mockResolvedValue(ctx({ isStaff: true, isAdmin: false }))
    expect((await call(adminOnly)).status).toBe(403)
  })

  it('public endpoints accept anonymous callers and pass ctx=null', async () => {
    optionalAuth.mockResolvedValue(null)
    const pub = defineEndpoint({
      operationId: 'getP', method: 'GET', path: '/p', summary: 'p', auth: 'public',
      response: z.object({ anon: z.boolean() }), handler: async ({ ctx }) => ({ anon: ctx === null }),
    })
    expect(await (await call(pub)).json()).toEqual({ data: { anon: true } })
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('answers 426 when X-App-Version is below the minimum', async () => {
    vi.stubEnv('MOBILE_MIN_APP_VERSION', '1.2.0')
    authenticate.mockResolvedValue(ctx())
    const res = await call(echo, { method: 'POST', body: JSON.stringify({ name: 'Ada' }) }, { 'x-app-version': '1.1.9+3' })
    expect(res.status).toBe(426)
    expect((await res.json()).error.code).toBe('app_update_required')
  })

  it('lets skipVersionGate endpoints through so the app can still read /config', async () => {
    vi.stubEnv('MOBILE_MIN_APP_VERSION', '9.9.9')
    optionalAuth.mockResolvedValue(null)
    const cfg = defineEndpoint({
      operationId: 'getC', method: 'GET', path: '/c', summary: 'c', auth: 'public', skipVersionGate: true,
      response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    expect((await call(cfg, undefined, { 'x-app-version': '1.0.0' })).status).toBe(200)
  })

  it('does not gate requests that send no version header', async () => {
    vi.stubEnv('MOBILE_MIN_APP_VERSION', '9.9.9')
    authenticate.mockResolvedValue(ctx())
    const res = await call(echo, { method: 'POST', body: JSON.stringify({ name: 'Ada' }) })
    expect(res.status).toBe(200)
  })

  it('hides unexpected errors behind a generic 500', async () => {
    authenticate.mockResolvedValue(ctx())
    const boom = defineEndpoint({
      operationId: 'getB', method: 'GET', path: '/b', summary: 'b', auth: 'user',
      response: z.object({ ok: z.boolean() }),
      handler: async () => { throw new Error('secret db detail') },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(boom)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret db detail')
    spy.mockRestore()
  })

  it('500s (and logs) when a handler violates its declared response schema', async () => {
    authenticate.mockResolvedValue(ctx())
    const bad = defineEndpoint({
      operationId: 'getBad', method: 'GET', path: '/bad', summary: 'bad', auth: 'user',
      response: z.object({ n: z.number() }),
      // @ts-expect-error deliberately wrong to prove the runtime contract check
      handler: async () => ({ n: 'not a number' }),
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(bad)).status).toBe(500)
    spy.mockRestore()
  })

  it('applies a custom cache-control', async () => {
    optionalAuth.mockResolvedValue(null)
    const cached = defineEndpoint({
      operationId: 'getK', method: 'GET', path: '/k', summary: 'k', auth: 'public',
      cacheControl: 'public, s-maxage=60', response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    expect((await call(cached)).headers.get('cache-control')).toBe('public, s-maxage=60')
  })

  it('passes route params through to the handler', async () => {
    authenticate.mockResolvedValue(ctx())
    const withParams = defineEndpoint({
      operationId: 'getWithId', method: 'GET', path: '/things/{id}', summary: 't', auth: 'user',
      response: z.object({ id: z.string() }),
      handler: async ({ params }) => ({ id: params.id }),
    })
    const res = await withParams.handler(
      new Request('https://x.test/api/mobile/v1/things/abc', { headers: { 'content-type': 'application/json' } }),
      { params: { id: 'abc' } },
    )
    expect(await res.json()).toEqual({ data: { id: 'abc' } })
  })

  it('defaults params to an empty object when no context is passed (static routes)', async () => {
    authenticate.mockResolvedValue(ctx())
    const noParams = defineEndpoint({
      operationId: 'getNoParams', method: 'GET', path: '/things', summary: 't', auth: 'user',
      response: z.object({ count: z.number() }),
      handler: async ({ params }) => ({ count: Object.keys(params).length }),
    })
    const res = await call(noParams)
    expect(await res.json()).toEqual({ data: { count: 0 } })
  })
})
