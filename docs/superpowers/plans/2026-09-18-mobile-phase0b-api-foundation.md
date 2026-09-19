# Mobile Phase 0B — `/api/mobile/v1` Foundation (web repo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the versioned, bearer-authenticated mobile API scaffold plus its first four endpoints (`GET /config`, `GET /me`, `POST /errors`, `POST|DELETE /devices`), a generated `openapi/mobile-v1.json` contract, and Android App Links support — so the Flutter app can make an authenticated round trip and every later phase only adds endpoints.

**Architecture:** Each endpoint is one `defineEndpoint({...})` value (method, path, auth level, zod body/response, handler) living in `lib/mobile-api/endpoints/`. `defineEndpoint` yields both a Next.js route handler (bearer auth via a network-verified `getUser(token)`, zod validation, `{data}` / `{error}` envelope, `X-Api-Version`, min-app-version gate) and OpenAPI metadata. Route files under `app/api/mobile/v1/**` are one-line re-exports. `openapi/mobile-v1.json` is a vitest **file snapshot** of the generated document, so `npm run test` fails whenever it is stale and `npm run openapi` refreshes it — no new dependency.

**Tech Stack:** Next.js 14 Route Handlers, TypeScript, zod 4.4.3 (`z.toJSONSchema`), `@supabase/supabase-js` 2.x, Vitest 4.

**Spec:** `C:\Users\gorok\sentinelx_mobile\docs\superpowers\specs\2026-09-18-flutter-mobile-app-master-design.md` §6.1, §6.2, §6.11, §7.1–§7.2, §13 Phase 0.

## Global Constraints

- Base path `/api/mobile/v1`. The middleware `matcher` already excludes `api`, so these routes bypass next-intl and the page auth guard — every handler authenticates itself.
- Auth header is `Authorization: Bearer <Supabase access token>`, verified with `supabase.auth.getUser(token)` (network-verified; **never** decode the JWT locally and never use `getSession()` — see the middleware timeout incident in `ROADMAP.md`).
- Success envelope `{ "data": … }`; error envelope `{ "error": { "code": string, "message": string, "fields"?: Record<string,string> } }`. `code` reuses the web's `errorCode` strings where one exists. Every response carries `X-Api-Version: 1`.
- Statuses used: 200, 400 `validation_failed`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 426 `app_update_required`, 500 `internal`.
- The service-role client is used **only** where the equivalent web code already uses it; the caller id always comes from the verified token, never from the request body.
- Migrations are timestamp-named (`20260918210000_…`). **Applying a migration to production requires the owner's explicit go-ahead.**
- Do not run `npm run build` while another session's `next dev` runs in this checkout; verify with `npx tsc --noEmit` + `npm run test`. Verify branch + `git diff --cached` before each commit. Work in a git worktree off `main`.
- **Deferred (YAGNI, per spec §7.2):** idempotency keys (`api_idempotency_keys`), rate limiting, `/session/start`, `/auth/signup`, upload signing — each lands with the first phase that needs it (Phase 1–2).
- Correction to the spec: `/config` has **no `paystackPublicKey`** — Paystack is server-initialised and the app opens `authorization_url` in a WebView; the web app has no public key in its env.

## File Structure

| File | Responsibility |
|---|---|
| `lib/mobile-api/errors.ts` | `ApiError`, `Errors` factory, `errorBody()` |
| `lib/mobile-api/version.ts` | `compareVersions()` for the min-version gate |
| `lib/mobile-api/auth.ts` | `readBearer`, `authenticate`, `optionalAuth`, `MobileCtx` |
| `lib/mobile-api/define-endpoint.ts` | `defineEndpoint()` → `{ meta, handler }`; envelope, validation, gates |
| `lib/mobile-api/openapi.ts` | `buildOpenApi(endpoints)` |
| `lib/mobile-api/endpoints/{config,me,client-errors,devices}.ts` | The four endpoint definitions |
| `lib/mobile-api/endpoints/index.ts` | `ALL_ENDPOINTS` list (single source for OpenAPI) |
| `app/api/mobile/v1/{config,me,errors,devices}/route.ts` | One-line handler re-exports |
| `app/.well-known/assetlinks.json/route.ts` | Android App Links verification file |
| `middleware.ts` (matcher) | Exclude `.well-known` from next-intl |
| `supabase/migrations/20260918210000_fcm_tokens_platform.sql` | Additive: `platform`, `app_version` on `fcm_tokens` |
| `openapi/mobile-v1.json` | Generated contract, copied into the mobile repo |
| `docs/superpowers/specs/2026-09-18-mobile-api-v1-conventions.md` | Conventions for later phases |

---

### Task 1: Errors and version comparison

**Files:**
- Create: `lib/mobile-api/errors.ts`, `lib/mobile-api/version.ts`
- Test: `lib/mobile-api/errors.test.ts`, `lib/mobile-api/version.test.ts`

**Interfaces:**
- Produces: `class ApiError(status: number, code: string, message: string, fields?: Record<string,string>)`; `Errors.{unauthorized,forbidden,notFound,validation(fields),upgradeRequired(min)}: () => ApiError`; `errorBody(e: ApiError): { error: { code: string; message: string; fields?: Record<string,string> } }`; `compareVersions(a: string, b: string): -1 | 0 | 1`.

- [ ] **Step 1: Write the failing tests**

`lib/mobile-api/version.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { compareVersions } from './version'

describe('compareVersions', () => {
  it('orders dotted numeric versions', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })
  it('ignores the +build suffix Flutter appends', () => {
    expect(compareVersions('1.0.0+45', '1.0.0')).toBe(0)
  })
  it('treats missing segments as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1', '1.0.1')).toBe(-1)
  })
  it('treats an unparseable version as 0.0.0', () => {
    expect(compareVersions('garbage', '0.0.1')).toBe(-1)
  })
})
```

`lib/mobile-api/errors.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { ApiError, Errors, errorBody } from './errors'

describe('errors', () => {
  it('unauthorized is a 401 with a stable code', () => {
    const e = Errors.unauthorized()
    expect(e).toBeInstanceOf(ApiError)
    expect([e.status, e.code]).toEqual([401, 'unauthorized'])
  })
  it('validation carries per-field codes into the body', () => {
    expect(errorBody(Errors.validation({ username: 'username_too_short' }))).toEqual({
      error: { code: 'validation_failed', message: 'Some fields are invalid.', fields: { username: 'username_too_short' } },
    })
  })
  it('omits fields when there are none', () => {
    expect(errorBody(Errors.forbidden())).toEqual({
      error: { code: 'forbidden', message: 'You do not have access to this.' },
    })
  })
  it('upgradeRequired is a 426 that names the minimum version', () => {
    const e = Errors.upgradeRequired('1.2.0')
    expect([e.status, e.code]).toEqual([426, 'app_update_required'])
    expect(e.message).toContain('1.2.0')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/mobile-api/errors.test.ts lib/mobile-api/version.test.ts` → Expected: FAIL (`Cannot find module './errors'` / `'./version'`).

- [ ] **Step 3: Implement**

`lib/mobile-api/errors.ts`
```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, 'unauthorized', 'Sign in required.'),
  forbidden: () => new ApiError(403, 'forbidden', 'You do not have access to this.'),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  validation: (fields: Record<string, string>) =>
    new ApiError(400, 'validation_failed', 'Some fields are invalid.', fields),
  upgradeRequired: (min: string) =>
    new ApiError(426, 'app_update_required', `Please update the app to version ${min} or newer.`),
}

export function errorBody(e: ApiError): {
  error: { code: string; message: string; fields?: Record<string, string> }
} {
  return { error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } }
}
```

`lib/mobile-api/version.ts`
```ts
function parts(v: string): number[] {
  const core = v.split('+')[0]
  const nums = core.split('.').map((s) => Number.parseInt(s, 10))
  return nums.map((n) => (Number.isNaN(n) ? 0 : n))
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
```

- [ ] **Step 4: Run to verify pass** — same command → Expected: 9 passed.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api && git diff --cached --stat
git commit -m "feat(mobile-api): ApiError envelope and version comparison"
```

---

### Task 2: Bearer authentication

**Files:**
- Create: `lib/mobile-api/auth.ts`
- Test: `lib/mobile-api/auth.test.ts`

**Interfaces:**
- Consumes: `Errors` (Task 1); `createAdminClient` from `@/lib/supabase/admin`; `Database` from `@/lib/supabase/types`; `type StaffRole` from `@/lib/admin/auth`.
- Produces:
  - `interface MobileCtx { userId: string; email: string | null; accessToken: string; roles: StaffRole[]; isStaff: boolean; isAdmin: boolean; userClient: SupabaseClient<Database>; admin: ReturnType<typeof createAdminClient> }`
  - `readBearer(req: Request): string | null`
  - `authenticate(req: Request): Promise<MobileCtx>` (throws `Errors.unauthorized()`)
  - `optionalAuth(req: Request): Promise<MobileCtx | null>` (never throws)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const rolesEq = vi.fn()
const fakeUserClient = {
  auth: { getUser },
  from: vi.fn(() => ({ select: () => ({ eq: rolesEq }) })),
}
const createClient = vi.fn(() => fakeUserClient)
vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ __admin: true }) }))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  getUser.mockReset()
  rolesEq.mockReset()
  createClient.mockClear()
})

const req = (authorization?: string) =>
  new Request('https://x.test/api/mobile/v1/me', { headers: authorization ? { authorization } : {} })

describe('readBearer', () => {
  it('extracts the token', async () => {
    const { readBearer } = await import('./auth')
    expect(readBearer(req('Bearer abc.def'))).toBe('abc.def')
    expect(readBearer(req('bearer abc'))).toBe('abc')
  })
  it('returns null for a missing or malformed header', async () => {
    const { readBearer } = await import('./auth')
    expect(readBearer(req())).toBeNull()
    expect(readBearer(req('Basic abc'))).toBeNull()
    expect(readBearer(req('Bearer'))).toBeNull()
  })
})

describe('authenticate', () => {
  it('throws unauthorized without a token and never touches Supabase', async () => {
    const { authenticate } = await import('./auth')
    await expect(authenticate(req())).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('throws unauthorized when Supabase rejects the token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })
    const { authenticate } = await import('./auth')
    await expect(authenticate(req('Bearer bad'))).rejects.toMatchObject({ status: 401 })
  })

  it('verifies the token over the network and builds the context', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    rolesEq.mockResolvedValue({ data: [{ role: 'moderator' }, { role: 'player' }] })
    const { authenticate } = await import('./auth')
    const ctx = await authenticate(req('Bearer good'))
    expect(getUser).toHaveBeenCalledWith('good')
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer good' } } }),
    )
    expect(ctx).toMatchObject({ userId: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false })
  })

  it('marks admins', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u2', email: null } }, error: null })
    rolesEq.mockResolvedValue({ data: [{ role: 'admin' }] })
    const { authenticate } = await import('./auth')
    const ctx = await authenticate(req('Bearer t'))
    expect([ctx.isStaff, ctx.isAdmin]).toEqual([true, true])
  })
})

describe('optionalAuth', () => {
  it('returns null instead of throwing for a bad token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    const { optionalAuth } = await import('./auth')
    await expect(optionalAuth(req('Bearer expired'))).resolves.toBeNull()
  })
  it('returns null with no header', async () => {
    const { optionalAuth } = await import('./auth')
    await expect(optionalAuth(req())).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/auth.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/mobile-api/auth.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StaffRole } from '@/lib/admin/auth'
import { Errors } from './errors'

const STAFF_ROLES: readonly string[] = ['admin', 'moderator']

export interface MobileCtx {
  userId: string
  email: string | null
  accessToken: string
  roles: StaffRole[]
  isStaff: boolean
  isAdmin: boolean
  /** RLS-scoped as the caller — use for reads RLS already scopes correctly. */
  userClient: SupabaseClient<Database>
  /** Service role. Only where the equivalent web code already uses it; id from ctx.userId, never the body. */
  admin: ReturnType<typeof createAdminClient>
}

export function readBearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

export async function authenticate(req: Request): Promise<MobileCtx> {
  const token = readBearer(req)
  if (!token) throw Errors.unauthorized()

  const userClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  )

  // Network-verified — the handler's own check is the security boundary.
  const { data, error } = await userClient.auth.getUser(token)
  if (error || !data.user) throw Errors.unauthorized()

  const { data: roleRows } = await userClient.from('user_roles').select('role').eq('user_id', data.user.id)
  const roles = (roleRows ?? [])
    .map((r) => r.role)
    .filter((r): r is StaffRole => STAFF_ROLES.includes(r))

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    accessToken: token,
    roles,
    isStaff: roles.length > 0,
    isAdmin: roles.includes('admin'),
    userClient,
    admin: createAdminClient(),
  }
}

export async function optionalAuth(req: Request): Promise<MobileCtx | null> {
  if (!readBearer(req)) return null
  try {
    return await authenticate(req)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run** the test → Expected: 8 passed. Then `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api && git diff --cached --stat
git commit -m "feat(mobile-api): bearer authentication with network-verified getUser"
```

---

### Task 3: `defineEndpoint` (envelope, validation, gates)

**Files:**
- Create: `lib/mobile-api/define-endpoint.ts`
- Test: `lib/mobile-api/define-endpoint.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `optionalAuth`, `MobileCtx` (Task 2); `ApiError`, `Errors`, `errorBody` (Task 1); `compareVersions` (Task 1); `z` from `zod`.
- Produces:
```ts
export type AuthLevel = 'public' | 'user' | 'staff' | 'admin'
export interface EndpointMeta {
  operationId: string; method: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE'; path: string; summary: string
  auth: AuthLevel; body?: z.ZodTypeAny; response: z.ZodTypeAny
}
export interface Endpoint { meta: EndpointMeta; handler: (req: Request) => Promise<Response> }
export function defineEndpoint<A extends AuthLevel, TBody extends z.ZodTypeAny = z.ZodUndefined, TRes extends z.ZodTypeAny = z.ZodTypeAny>(def: {
  operationId: string; method: EndpointMeta['method']; path: string; summary: string
  auth: A; body?: TBody; response: TRes
  cacheControl?: string          // default 'no-store'
  skipVersionGate?: boolean      // /config, /errors
  handler: (input: { ctx: A extends 'public' ? MobileCtx | null : MobileCtx; body: z.infer<TBody>; req: Request }) => Promise<z.infer<TRes>>
}): Endpoint
```
Minimum app version comes from `process.env.MOBILE_MIN_APP_VERSION` (default `'0.0.0'`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const authenticate = vi.fn()
const optionalAuth = vi.fn()
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
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/define-endpoint.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/mobile-api/define-endpoint.ts`**

```ts
import { z } from 'zod'
import { authenticate, optionalAuth, type MobileCtx } from './auth'
import { ApiError, Errors, errorBody } from './errors'
import { compareVersions } from './version'

export type AuthLevel = 'public' | 'user' | 'staff' | 'admin'

export interface EndpointMeta {
  operationId: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  summary: string
  auth: AuthLevel
  body?: z.ZodTypeAny
  response: z.ZodTypeAny
}

export interface Endpoint {
  meta: EndpointMeta
  handler: (req: Request) => Promise<Response>
}

const HEADERS = { 'x-api-version': '1' }

function json(status: number, payload: unknown, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl, ...HEADERS },
  })
}

// First issue per path wins; messages are the shared errorCode strings the web already uses.
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}

export function defineEndpoint<
  A extends AuthLevel,
  TBody extends z.ZodTypeAny = z.ZodUndefined,
  TRes extends z.ZodTypeAny = z.ZodTypeAny,
>(def: {
  operationId: string
  method: EndpointMeta['method']
  path: string
  summary: string
  auth: A
  body?: TBody
  response: TRes
  cacheControl?: string
  skipVersionGate?: boolean
  handler: (input: {
    ctx: A extends 'public' ? MobileCtx | null : MobileCtx
    body: z.infer<TBody>
    req: Request
  }) => Promise<z.infer<TRes>>
}): Endpoint {
  const meta: EndpointMeta = {
    operationId: def.operationId,
    method: def.method,
    path: def.path,
    summary: def.summary,
    auth: def.auth,
    body: def.body,
    response: def.response,
  }

  async function handler(req: Request): Promise<Response> {
    try {
      const appVersion = req.headers.get('x-app-version')
      const min = process.env.MOBILE_MIN_APP_VERSION ?? '0.0.0'
      if (!def.skipVersionGate && appVersion && compareVersions(appVersion, min) < 0) {
        throw Errors.upgradeRequired(min)
      }

      let ctx: MobileCtx | null
      if (def.auth === 'public') {
        ctx = await optionalAuth(req)
      } else {
        ctx = await authenticate(req)
        if ((def.auth === 'staff' && !ctx.isStaff) || (def.auth === 'admin' && !ctx.isAdmin)) {
          throw Errors.forbidden()
        }
      }

      let body: unknown = undefined
      if (def.body) {
        const raw = await req.json().catch(() => undefined)
        const parsed = def.body.safeParse(raw)
        if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error))
        body = parsed.data
      }

      const result = await def.handler({ ctx: ctx as never, body: body as never, req })
      // Enforces the published contract at runtime: a drifting handler 500s in dev/CI, not in a user's hand.
      const data = def.response.parse(result)
      return json(200, { data }, def.cacheControl)
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, errorBody(e))
      console.error('[mobile-api] unhandled', { path: def.path, message: e instanceof Error ? e.message : String(e) })
      return json(500, { error: { code: 'internal', message: 'Something went wrong.' } })
    }
  }

  return { meta, handler }
}
```

- [ ] **Step 4: Run** the test → Expected: 11 passed. `npx tsc --noEmit` → clean (the `@ts-expect-error` line in the test must be *used*; if tsc reports "unused @ts-expect-error", the handler return type is not being checked — fix the generics before continuing).

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api && git diff --cached --stat
git commit -m "feat(mobile-api): defineEndpoint with envelope, validation, staff gates and min-version gate"
```

---

### Task 4: OpenAPI document + committed contract snapshot

**Files:**
- Create: `lib/mobile-api/openapi.ts`, `lib/mobile-api/endpoints/index.ts` (empty list for now), `openapi/mobile-v1.json` (generated)
- Test: `lib/mobile-api/openapi.test.ts`
- Modify: `package.json` (add script)

**Interfaces:**
- Consumes: `Endpoint`, `EndpointMeta` (Task 3); `z.toJSONSchema`.
- Produces: `buildOpenApi(endpoints: Endpoint[]): Record<string, unknown>`; `ALL_ENDPOINTS: Endpoint[]` from `lib/mobile-api/endpoints/index.ts`; npm script `openapi`.

- [ ] **Step 1: Write the failing test**

`lib/mobile-api/openapi.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineEndpoint } from './define-endpoint'
import { buildOpenApi } from './openapi'
import { ALL_ENDPOINTS } from './endpoints'

const ep = defineEndpoint({
  operationId: 'postThing', method: 'POST', path: '/thing', summary: 'Make a thing', auth: 'user',
  body: z.object({ name: z.string().min(2) }),
  response: z.object({ id: z.string() }),
  handler: async () => ({ id: 'x' }),
})
const pub = defineEndpoint({
  operationId: 'getOpen', method: 'GET', path: '/open', summary: 'Open', auth: 'public',
  response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
})

describe('buildOpenApi', () => {
  const doc = buildOpenApi([ep, pub]) as any

  it('declares OpenAPI 3.1 and bearer auth', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
  })
  it('prefixes paths with /api/mobile/v1 and keys operations by lower-case method', () => {
    expect(doc.paths['/api/mobile/v1/thing'].post.operationId).toBe('postThing')
    expect(doc.paths['/api/mobile/v1/open'].get.operationId).toBe('getOpen')
  })
  it('requires bearer auth for non-public endpoints only', () => {
    expect(doc.paths['/api/mobile/v1/thing'].post.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/mobile/v1/open'].get.security).toEqual([])
  })
  it('wraps the response in the {data} envelope and documents the error envelope', () => {
    const ok = doc.paths['/api/mobile/v1/thing'].post.responses['200'].content['application/json'].schema
    expect(ok.required).toEqual(['data'])
    expect(ok.properties.data.properties.id.type).toBe('string')
    expect(doc.components.schemas.ApiError.properties.error.required).toEqual(['code', 'message'])
  })
  it('emits the request body schema without a $schema key', () => {
    const body = doc.paths['/api/mobile/v1/thing'].post.requestBody.content['application/json'].schema
    expect(body.properties.name.minLength).toBe(2)
    expect(body.$schema).toBeUndefined()
  })
  it('has unique operation ids', () => {
    const ids = buildOpenApi(ALL_ENDPOINTS) as any
    const seen = Object.values(ids.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId))
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('committed contract', () => {
  it('openapi/mobile-v1.json is up to date — run `npm run openapi` if this fails', async () => {
    const doc = buildOpenApi(ALL_ENDPOINTS)
    await expect(JSON.stringify(doc, null, 2) + '\n').toMatchFileSnapshot('../../openapi/mobile-v1.json')
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/openapi.test.ts` → Expected: FAIL (`./openapi` / `./endpoints` missing).

- [ ] **Step 3: Implement**

`lib/mobile-api/endpoints/index.ts`
```ts
import type { Endpoint } from '../define-endpoint'

// Single source of truth for the OpenAPI document. Append each new endpoint here.
export const ALL_ENDPOINTS: Endpoint[] = []
```

`lib/mobile-api/openapi.ts`
```ts
import { z } from 'zod'
import type { Endpoint } from './define-endpoint'

function schemaOf(s: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s) as Record<string, unknown>
  return rest
}

const ERROR_RESPONSES = {
  '400': { $ref: '#/components/responses/ValidationFailed' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '426': { $ref: '#/components/responses/UpgradeRequired' },
  '500': { $ref: '#/components/responses/Internal' },
}

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
})

export function buildOpenApi(endpoints: Endpoint[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const { meta } of [...endpoints].sort((a, b) => a.meta.path.localeCompare(b.meta.path) || a.meta.method.localeCompare(b.meta.method))) {
    const full = `/api/mobile/v1${meta.path}`
    paths[full] ??= {}
    paths[full][meta.method.toLowerCase()] = {
      operationId: meta.operationId,
      summary: meta.summary,
      security: meta.auth === 'public' ? [] : [{ bearerAuth: [] }],
      ...(meta.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(meta.body) } } } }
        : {}),
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'object', required: ['data'], properties: { data: schemaOf(meta.response) } },
            },
          },
        },
        ...ERROR_RESPONSES,
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Sentinel X Mobile API', version: '1' },
    servers: [{ url: 'https://sentinelxesports.com.ng' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        ApiError: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                fields: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        ValidationFailed: errorResponse('Request body failed validation (code `validation_failed`).'),
        Unauthorized: errorResponse('Missing or invalid bearer token (code `unauthorized`).'),
        Forbidden: errorResponse('Authenticated but not allowed (code `forbidden`).'),
        UpgradeRequired: errorResponse('X-App-Version is below the supported minimum (code `app_update_required`).'),
        Internal: errorResponse('Unexpected server error (code `internal`).'),
      },
    },
  }
}
```

`package.json` — add to `"scripts"`:
```json
    "openapi": "vitest run lib/mobile-api/openapi.test.ts -u"
```

- [ ] **Step 4: Generate the snapshot and re-run**

Run: `npm run openapi` → creates `openapi/mobile-v1.json`. Then `npx vitest run lib/mobile-api/openapi.test.ts` → Expected: 7 passed.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api openapi package.json && git diff --cached --stat
git commit -m "feat(mobile-api): OpenAPI 3.1 generator and committed contract snapshot"
```

---

### Task 5: `GET /config`

**Files:**
- Create: `lib/mobile-api/endpoints/config.ts`, `app/api/mobile/v1/config/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`
- Test: `lib/mobile-api/endpoints/config.test.ts`

**Interfaces:**
- Consumes: `defineEndpoint` (Task 3); `SITE_URL` from `@/lib/seo/site`; `COINS_PER_NAIRA, NAIRA_PER_COIN, COINS_PER_ENTRY, COINS_HALF_ENTRY` from `@/lib/coins/value`; `ENFORCE_PHONE_VERIFICATION` from `@/lib/onboarding/gate`.
- Produces: `featureFlags(off: string | undefined): Record<string, boolean>`; `buildConfig(env: NodeJS.ProcessEnv): ConfigResponse`; `configEndpoint: Endpoint`. Env inputs: `MOBILE_MIN_APP_VERSION` (default `0.0.0`), `MOBILE_LATEST_APP_VERSION` (default `1.0.0`), `MOBILE_MAINTENANCE_MESSAGE` (empty/unset = off), `MOBILE_FEATURES_OFF` (comma-separated feature keys), `NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildConfig, featureFlags } from './config'

describe('featureFlags', () => {
  it('enables every known feature by default', () => {
    const f = featureFlags(undefined)
    expect(Object.values(f).every((v) => v === true)).toBe(true)
    expect(Object.keys(f)).toEqual(
      expect.arrayContaining(['community', 'exchange', 'friendlies', 'messages', 'store', 'tv', 'wagering']),
    )
  })
  it('turns listed features off, tolerating spaces and unknown keys', () => {
    const f = featureFlags(' wagering , exchange ,nonsense')
    expect(f.wagering).toBe(false)
    expect(f.exchange).toBe(false)
    expect(f.store).toBe(true)
    expect('nonsense' in f).toBe(false)
  })
})

describe('buildConfig', () => {
  it('reports defaults with no env', () => {
    const c = buildConfig({})
    expect(c.minSupportedAppVersion).toBe('0.0.0')
    expect(c.latestAppVersion).toBe('1.0.0')
    expect(c.maintenance).toBeNull()
    expect(c.whatsappCommunityUrl).toBeNull()
    expect(c.coins).toEqual({ coinsPerNaira: 2, nairaPerCoin: 0.5, coinsPerEntry: 1000, coinsHalfEntry: 500 })
    expect(c.enforcePhoneVerification).toBe(false)
    expect(c.siteUrl).toMatch(/^https:\/\//)
  })
  it('reads overrides from env', () => {
    const c = buildConfig({
      MOBILE_MIN_APP_VERSION: '1.2.0',
      MOBILE_LATEST_APP_VERSION: '1.4.0',
      MOBILE_MAINTENANCE_MESSAGE: 'Back at 3pm',
      NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'https://chat.whatsapp.com/abc',
      MOBILE_FEATURES_OFF: 'wagering',
    })
    expect(c.minSupportedAppVersion).toBe('1.2.0')
    expect(c.latestAppVersion).toBe('1.4.0')
    expect(c.maintenance).toEqual({ message: 'Back at 3pm' })
    expect(c.whatsappCommunityUrl).toBe('https://chat.whatsapp.com/abc')
    expect(c.features.wagering).toBe(false)
  })
  it('treats the web placeholder "#" as no community link', () => {
    expect(buildConfig({ NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: '#' }).whatsappCommunityUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/endpoints/config.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/mobile-api/endpoints/config.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { SITE_URL } from '@/lib/seo/site'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY, COINS_PER_NAIRA, NAIRA_PER_COIN } from '@/lib/coins/value'
import { ENFORCE_PHONE_VERIFICATION } from '@/lib/onboarding/gate'

// One key per app surface a store reviewer or regulator could force us to hide (spec §14).
const FEATURE_KEYS = ['community', 'exchange', 'friendlies', 'messages', 'store', 'tv', 'wagering'] as const

export function featureFlags(off: string | undefined): Record<string, boolean> {
  const disabled = new Set((off ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, !disabled.has(k)]))
}

const configResponse = z.object({
  minSupportedAppVersion: z.string(),
  latestAppVersion: z.string(),
  maintenance: z.object({ message: z.string() }).nullable(),
  siteUrl: z.string(),
  coins: z.object({
    coinsPerNaira: z.number(),
    nairaPerCoin: z.number(),
    coinsPerEntry: z.number(),
    coinsHalfEntry: z.number(),
  }),
  enforcePhoneVerification: z.boolean(),
  whatsappCommunityUrl: z.string().nullable(),
  features: z.record(z.string(), z.boolean()),
})
export type ConfigResponse = z.infer<typeof configResponse>

export function buildConfig(env: NodeJS.ProcessEnv): ConfigResponse {
  const community = env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL
  const maintenance = env.MOBILE_MAINTENANCE_MESSAGE?.trim()
  return {
    minSupportedAppVersion: env.MOBILE_MIN_APP_VERSION ?? '0.0.0',
    latestAppVersion: env.MOBILE_LATEST_APP_VERSION ?? '1.0.0',
    maintenance: maintenance ? { message: maintenance } : null,
    siteUrl: SITE_URL,
    coins: {
      coinsPerNaira: COINS_PER_NAIRA,
      nairaPerCoin: NAIRA_PER_COIN,
      coinsPerEntry: COINS_PER_ENTRY,
      coinsHalfEntry: COINS_HALF_ENTRY,
    },
    enforcePhoneVerification: ENFORCE_PHONE_VERIFICATION,
    whatsappCommunityUrl: community && community !== '#' ? community : null,
    features: featureFlags(env.MOBILE_FEATURES_OFF),
  }
}

export const configEndpoint = defineEndpoint({
  operationId: 'getConfig',
  method: 'GET',
  path: '/config',
  summary: 'Runtime configuration, kill-switch and feature flags (unauthenticated, cacheable).',
  auth: 'public',
  skipVersionGate: true, // the update-required screen needs to read this
  cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
  response: configResponse,
  handler: async () => buildConfig(process.env),
})
```

`app/api/mobile/v1/config/route.ts`
```ts
import { configEndpoint } from '@/lib/mobile-api/endpoints/config'

export const GET = configEndpoint.handler
```

`lib/mobile-api/endpoints/index.ts`
```ts
import type { Endpoint } from '../define-endpoint'
import { configEndpoint } from './config'

// Single source of truth for the OpenAPI document. Append each new endpoint here.
export const ALL_ENDPOINTS: Endpoint[] = [configEndpoint]
```

- [ ] **Step 4: Refresh the contract and verify**

Run: `npm run openapi` then `npx vitest run lib/mobile-api` → Expected: all pass. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api app/api/mobile openapi && git diff --cached --stat
git commit -m "feat(mobile-api): GET /config (kill-switch, coins constants, feature flags)"
```

---

### Task 6: `GET /me` and `POST /errors`

**Files:**
- Create: `lib/mobile-api/endpoints/me.ts`, `lib/mobile-api/endpoints/client-errors.ts`, `app/api/mobile/v1/me/route.ts`, `app/api/mobile/v1/errors/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`
- Test: `lib/mobile-api/endpoints/me.test.ts`, `lib/mobile-api/endpoints/client-errors.test.ts`

**Interfaces:**
- Consumes: `defineEndpoint`, `MobileCtx`.
- Produces: `meEndpoint` (`GET /me` → `{ id, email, roles, isStaff, isAdmin, profile }`), `errorsEndpoint` (`POST /errors` → `{ ok: true }`), pure helpers `toMeResponse(ctx, row)` and `buildErrorRow(body, userId)`.

- [ ] **Step 1: Write the failing tests**

`lib/mobile-api/endpoints/me.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { toMeResponse } from './me'

const ctx = { userId: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false } as never

describe('toMeResponse', () => {
  it('maps the profile row to camelCase and carries the role flags the app needs to show Admin', () => {
    const res = toMeResponse(ctx, {
      username: 'ada', display_name: 'Ada', avatar_url: null, whatsapp_number: '0803', country: 'NG',
      locale: 'en', membership_tier: 'guardian', kyc_verified: false, deletion_requested_at: null,
    })
    expect(res).toEqual({
      id: 'u1', email: 'a@b.c', roles: ['moderator'], isStaff: true, isAdmin: false,
      profile: {
        username: 'ada', displayName: 'Ada', avatarUrl: null, whatsappNumber: '0803', country: 'NG',
        locale: 'en', membershipTier: 'guardian', kycVerified: false, deletionRequestedAt: null,
      },
    })
  })
  it('returns a null profile when the row does not exist yet', () => {
    expect(toMeResponse(ctx, null).profile).toBeNull()
  })
})
```

`lib/mobile-api/endpoints/client-errors.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { buildErrorRow } from './client-errors'

describe('buildErrorRow', () => {
  it('folds platform and app version into user_agent and truncates oversize text', () => {
    const row = buildErrorRow(
      { message: 'x'.repeat(5000), stack: 'y'.repeat(9000), route: '/tournaments/abc', platform: 'android', appVersion: '1.0.0+3', locale: 'pcm' },
      'u1',
    )
    expect(row.user_agent).toBe('sentinelx-mobile/1.0.0+3 (android)')
    expect(row.message).toHaveLength(4000)
    expect(row.stack).toHaveLength(8000)
    expect(row).toMatchObject({ user_id: 'u1', url: '/tournaments/abc', locale: 'pcm', digest: null })
  })
  it('records anonymous reports with a null user id', () => {
    expect(buildErrorRow({ message: 'boom', platform: 'ios', appVersion: '1.0.0' }, null).user_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/endpoints/me.test.ts lib/mobile-api/endpoints/client-errors.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/mobile-api/endpoints/me.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'

const meResponse = z.object({
  id: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  isStaff: z.boolean(),
  isAdmin: z.boolean(),
  profile: z
    .object({
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      whatsappNumber: z.string().nullable(),
      country: z.string().nullable(),
      locale: z.string().nullable(),
      membershipTier: z.string().nullable(),
      kycVerified: z.boolean(),
      deletionRequestedAt: z.string().nullable(),
    })
    .nullable(),
})

interface ProfileRow {
  username: string | null
  display_name: string | null
  avatar_url: string | null
  whatsapp_number: string | null
  country: string | null
  locale: string | null
  membership_tier: string | null
  kyc_verified: boolean
  deletion_requested_at: string | null
}

export function toMeResponse(ctx: Pick<MobileCtx, 'userId' | 'email' | 'roles' | 'isStaff' | 'isAdmin'>, row: ProfileRow | null) {
  return {
    id: ctx.userId,
    email: ctx.email,
    roles: ctx.roles as string[],
    isStaff: ctx.isStaff,
    isAdmin: ctx.isAdmin,
    profile: row && {
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      whatsappNumber: row.whatsapp_number,
      country: row.country,
      locale: row.locale,
      membershipTier: row.membership_tier,
      kycVerified: row.kyc_verified,
      deletionRequestedAt: row.deletion_requested_at,
    },
  }
}

export const meEndpoint = defineEndpoint({
  operationId: 'getMe',
  method: 'GET',
  path: '/me',
  summary: 'The signed-in user, their roles (drives the role-aware Admin section) and own profile.',
  auth: 'user',
  response: meResponse,
  handler: async ({ ctx }) => {
    // Own row only, id from the verified token. Service role because whatsapp_number and
    // deletion_requested_at are private columns (plan 2026-09-18-mobile-phase0a-security-hardening.md).
    const { data } = await ctx.admin
      .from('profiles')
      .select('username, display_name, avatar_url, whatsapp_number, country, locale, membership_tier, kyc_verified, deletion_requested_at')
      .eq('id', ctx.userId)
      .maybeSingle()
    return toMeResponse(ctx, data)
  },
})
```

`lib/mobile-api/endpoints/client-errors.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'

const errorBodySchema = z.object({
  message: z.string().min(1).max(20000),
  stack: z.string().max(40000).optional(),
  route: z.string().max(500).optional(),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(40),
  locale: z.string().max(10).optional(),
})
type ErrorBody = z.infer<typeof errorBodySchema>

// Reuses public.client_error_logs (same table the web error boundaries write) so staff see
// mobile crashes in the same place. Platform/version ride in user_agent; no schema change.
export function buildErrorRow(body: ErrorBody, userId: string | null) {
  return {
    user_id: userId,
    message: body.message.slice(0, 4000),
    stack: body.stack?.slice(0, 8000) ?? null,
    digest: null,
    url: body.route ?? null,
    user_agent: `sentinelx-mobile/${body.appVersion} (${body.platform})`,
    locale: body.locale ?? null,
  }
}

export const errorsEndpoint = defineEndpoint({
  operationId: 'postClientError',
  method: 'POST',
  path: '/errors',
  summary: 'Report an app crash/exception into client_error_logs. Works signed-out. Never fails the caller.',
  auth: 'public', // a crash on the login screen is exactly what we need to see
  skipVersionGate: true, // outdated apps must still be able to report why they broke
  body: errorBodySchema,
  response: z.object({ ok: z.literal(true) }),
  handler: async ({ ctx, body }) => {
    try {
      const admin = ctx?.admin ?? (await import('@/lib/supabase/admin')).createAdminClient()
      await admin.from('client_error_logs').insert(buildErrorRow(body, ctx?.userId ?? null))
    } catch {
      // Logging must never fail the caller — same rule as lib/errors/actions.ts.
    }
    return { ok: true as const }
  },
})
```

`app/api/mobile/v1/me/route.ts`
```ts
import { meEndpoint } from '@/lib/mobile-api/endpoints/me'

export const GET = meEndpoint.handler
```

`app/api/mobile/v1/errors/route.ts`
```ts
import { errorsEndpoint } from '@/lib/mobile-api/endpoints/client-errors'

export const POST = errorsEndpoint.handler
```

`lib/mobile-api/endpoints/index.ts` → `import { meEndpoint } from './me'`, `import { errorsEndpoint } from './client-errors'`, and `export const ALL_ENDPOINTS: Endpoint[] = [configEndpoint, meEndpoint, errorsEndpoint]`.

- [ ] **Step 4: Refresh contract and verify**

Run: `npm run openapi` → `npx vitest run lib/mobile-api` → all pass; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api app/api/mobile openapi && git diff --cached --stat
git commit -m "feat(mobile-api): GET /me (role-aware) and POST /errors (client_error_logs)"
```

---

### Task 7: Device registration (`/devices`) + additive migration

**Files:**
- Create: `supabase/migrations/20260918210000_fcm_tokens_platform.sql`, `lib/mobile-api/endpoints/devices.ts`, `app/api/mobile/v1/devices/route.ts`
- Modify: `lib/supabase/types.ts` (fcm_tokens Row/Insert/Update), `lib/mobile-api/endpoints/index.ts`
- Test: `lib/mobile-api/endpoints/devices.test.ts`

**Interfaces:**
- Consumes: `defineEndpoint`, `MobileCtx`.
- Produces: `registerDevice(admin, userId, body)`, `unregisterDevice(admin, userId, token)`, `registerDeviceEndpoint` (`POST /devices`), `unregisterDeviceEndpoint` (`DELETE /devices`); routes export `POST` and `DELETE`.

- [ ] **Step 1: Migration (additive, safe for the running web app)**

`supabase/migrations/20260918210000_fcm_tokens_platform.sql`
```sql
-- Mobile registers native FCM tokens into the same table as web. Defaults keep every
-- existing web row and the existing /api/notifications/fcm-token route valid unchanged.
ALTER TABLE public.fcm_tokens
  ADD COLUMN IF NOT EXISTS platform    text NOT NULL DEFAULT 'web'
    CHECK (platform IN ('web', 'android', 'ios')),
  ADD COLUMN IF NOT EXISTS app_version text;
```
**Do not apply yet** — application is gated on the owner's go-ahead in Task 9.

- [ ] **Step 2: Update generated types by hand (small, avoids the types-regen collision documented in memory)**

In `lib/supabase/types.ts`, inside `fcm_tokens` (`Row`, `Insert`, `Update`) add — keeping alphabetical order:
```ts
// Row
app_version: string | null
platform: string
// Insert
app_version?: string | null
platform?: string
// Update
app_version?: string | null
platform?: string
```

- [ ] **Step 3: Write the failing test**

`lib/mobile-api/endpoints/devices.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest'
import { registerDevice, unregisterDevice } from './devices'

function fakeAdmin(result: { error: { message: string; code?: string } | null } = { error: null }) {
  const calls: Record<string, unknown[]> = { upsert: [], deleteMatch: [] }
  const admin = {
    from: vi.fn(() => ({
      upsert: (row: unknown, opts: unknown) => { calls.upsert.push([row, opts]); return Promise.resolve(result) },
      delete: () => ({
        eq: (col1: string, v1: string) => ({
          eq: (col2: string, v2: string) => { calls.deleteMatch.push([col1, v1, col2, v2]); return Promise.resolve(result) },
        }),
      }),
    })),
  }
  return { admin: admin as never, calls }
}

describe('registerDevice', () => {
  it('upserts by token, reassigning the row to the verified caller', async () => {
    const { admin, calls } = fakeAdmin()
    await registerDevice(admin, 'u1', { token: 't'.repeat(40), platform: 'android', appVersion: '1.0.0' })
    const [row, opts] = calls.upsert[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(row).toMatchObject({ player_id: 'u1', token: 't'.repeat(40), platform: 'android', app_version: '1.0.0' })
    expect(typeof row.last_active).toBe('string')
    expect(opts).toEqual({ onConflict: 'token' })
  })
  it('throws when the upsert fails so the caller sees a 500, not a silent success', async () => {
    const { admin } = fakeAdmin({ error: { message: 'boom', code: '23505' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(registerDevice(admin, 'u1', { token: 't'.repeat(40), platform: 'ios', appVersion: '1' })).rejects.toThrow()
    spy.mockRestore()
  })
})

describe('unregisterDevice', () => {
  it('deletes only this caller’s row for that token', async () => {
    const { admin, calls } = fakeAdmin()
    await unregisterDevice(admin, 'u1', 'tok')
    expect(calls.deleteMatch[0]).toEqual(['token', 'tok', 'player_id', 'u1'])
  })
})
```

- [ ] **Step 4: Run** → FAIL (module missing).

- [ ] **Step 5: Implement**

`lib/mobile-api/endpoints/devices.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'

type Admin = MobileCtx['admin']

const deviceBody = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(40),
})
const tokenBody = z.object({ token: z.string().min(20).max(4096) })

// Service role on purpose, exactly like app/api/notifications/fcm-token/route.ts: one physical
// device carries its FCM token across accounts, and a second account's upsert would otherwise
// trip fcm_tokens_owner's USING clause (42501) permanently. player_id comes from the verified
// token, never the body, so a caller can only ever claim a token FOR THEMSELVES.
export async function registerDevice(admin: Admin, userId: string, body: z.infer<typeof deviceBody>): Promise<void> {
  const { error } = await admin.from('fcm_tokens').upsert(
    {
      player_id: userId,
      token: body.token,
      platform: body.platform,
      app_version: body.appVersion,
      last_active: new Date().toISOString(),
    },
    { onConflict: 'token' },
  )
  if (error) {
    console.error('[mobile-api/devices] upsert failed', { userId, code: (error as { code?: string }).code, message: error.message })
    throw new Error('device registration failed')
  }
}

export async function unregisterDevice(admin: Admin, userId: string, token: string): Promise<void> {
  await admin.from('fcm_tokens').delete().eq('token', token).eq('player_id', userId)
}

const ok = z.object({ ok: z.literal(true) })

export const registerDeviceEndpoint = defineEndpoint({
  operationId: 'postDevice',
  method: 'POST',
  path: '/devices',
  summary: 'Register (or move to this account) this device’s native FCM token.',
  auth: 'user',
  body: deviceBody,
  response: ok,
  handler: async ({ ctx, body }) => {
    await registerDevice(ctx.admin, ctx.userId, body)
    return { ok: true as const }
  },
})

export const unregisterDeviceEndpoint = defineEndpoint({
  operationId: 'deleteDevice',
  method: 'DELETE',
  path: '/devices',
  summary: 'Unregister this device’s token (call before sign-out).',
  auth: 'user',
  body: tokenBody,
  response: ok,
  handler: async ({ ctx, body }) => {
    await unregisterDevice(ctx.admin, ctx.userId, body.token)
    return { ok: true as const }
  },
})
```

`app/api/mobile/v1/devices/route.ts`
```ts
import { registerDeviceEndpoint, unregisterDeviceEndpoint } from '@/lib/mobile-api/endpoints/devices'

export const POST = registerDeviceEndpoint.handler
export const DELETE = unregisterDeviceEndpoint.handler
```

Update `lib/mobile-api/endpoints/index.ts` to `[configEndpoint, meEndpoint, errorsEndpoint, registerDeviceEndpoint, unregisterDeviceEndpoint]` (with the imports).

- [ ] **Step 6: Refresh contract and verify**

Run: `npm run openapi` → `npx vitest run lib/mobile-api` → pass; `npx tsc --noEmit` → clean (this also proves the hand-edited `fcm_tokens` types line up).

- [ ] **Step 7: Commit**
```bash
git add lib/mobile-api app/api/mobile lib/supabase/types.ts supabase/migrations/20260918210000_fcm_tokens_platform.sql openapi
git diff --cached --stat
git commit -m "feat(mobile-api): device registration endpoints and additive fcm_tokens platform migration (unapplied)"
```

---

### Task 8: Android App Links (`assetlinks.json`) and middleware exclusion

**Files:**
- Create: `app/.well-known/assetlinks.json/route.ts`, `lib/mobile-api/assetlinks.ts`
- Modify: `middleware.ts` (matcher)
- Test: `lib/mobile-api/assetlinks.test.ts`, `middleware.test.ts` (add a case)

**Interfaces:** Produces `buildAssetLinks(packageName: string, fingerprints: string | undefined): unknown[]`. Env: `ANDROID_PACKAGE_NAME` (default `ng.com.sentinelxesports.app`), `ANDROID_CERT_SHA256` (comma-separated SHA-256 fingerprints; comes from the Flutter signing keys, Plan 0C Task 7).

- [ ] **Step 1: Write the failing tests**

`lib/mobile-api/assetlinks.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { buildAssetLinks } from './assetlinks'

describe('buildAssetLinks', () => {
  it('emits the Digital Asset Links statement for the app', () => {
    expect(buildAssetLinks('ng.com.sentinelxesports.app', 'AA:BB, CC:DD')).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'ng.com.sentinelxesports.app',
          sha256_cert_fingerprints: ['AA:BB', 'CC:DD'],
        },
      },
    ])
  })
  it('returns an empty list until a fingerprint is configured (never a statement with no certs)', () => {
    expect(buildAssetLinks('x.y', undefined)).toEqual([])
    expect(buildAssetLinks('x.y', ' , ')).toEqual([])
  })
})
```

Add to the end of `middleware.test.ts`:
```ts
describe('middleware matcher', () => {
  it('does not run on .well-known files (next-intl would rewrite them to /en/… and 404 App Links)', async () => {
    const { config } = await import('./middleware')
    const re = new RegExp(`^${config.matcher[0]}$`)
    expect(re.test('/.well-known/assetlinks.json')).toBe(false)
    expect(re.test('/tournaments')).toBe(true)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/assetlinks.test.ts middleware.test.ts` → Expected: FAIL (module missing; matcher still matches `.well-known`).

- [ ] **Step 3: Implement**

`lib/mobile-api/assetlinks.ts`
```ts
export function buildAssetLinks(packageName: string, fingerprints: string | undefined): unknown[] {
  const certs = (fingerprints ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (certs.length === 0) return []
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: certs },
    },
  ]
}
```

`app/.well-known/assetlinks.json/route.ts`
```ts
import { buildAssetLinks } from '@/lib/mobile-api/assetlinks'

export const dynamic = 'force-dynamic'

export function GET() {
  const body = buildAssetLinks(process.env.ANDROID_PACKAGE_NAME ?? 'ng.com.sentinelxesports.app', process.env.ANDROID_CERT_SHA256)
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  })
}
```

`middleware.ts` — in `config.matcher`, add `\\.well-known/` right after `auth/`:
```ts
    '/((?!_next/static|_next/image|favicon.ico|auth/|\\.well-known/|api|offline|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|opengraph-image|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
```
and extend the explanatory comment above it with: `// \`.well-known/\` (Android App Links assetlinks.json, app/.well-known/) is the same problem: not a page, must not be locale-rewritten.`

- [ ] **Step 4: Run** the two tests → Expected: pass. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api middleware.ts middleware.test.ts app/.well-known && git diff --cached --stat
git commit -m "feat(mobile-api): assetlinks.json for Android App Links; exclude .well-known from next-intl"
```

---

### Task 9: Conventions doc, ship, and round-trip check

**Files:**
- Create: `docs/superpowers/specs/2026-09-18-mobile-api-v1-conventions.md`
- Modify: `ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Write the conventions doc** (short; it is what later phases' authors read). Contents: base path; envelope; error-code rules (reuse web `errorCode`s); auth levels; how to add an endpoint (define in `lib/mobile-api/endpoints/<domain>.ts`, append to `ALL_ENDPOINTS`, add a one-line route file, `npm run openapi`, commit `openapi/mobile-v1.json`); the extraction rule from spec §7.1 (endpoint handler and Server Action must call the same service function; never fork logic); idempotency/rate-limit/uploads marked "added by the first phase that needs them"; env var table (`MOBILE_MIN_APP_VERSION`, `MOBILE_LATEST_APP_VERSION`, `MOBILE_MAINTENANCE_MESSAGE`, `MOBILE_FEATURES_OFF`, `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_SHA256`).

- [ ] **Step 2: Add a one-line rule to web `CLAUDE.md` and a `ROADMAP.md` follow-up entry** referencing this plan and `openapi/mobile-v1.json` as the contract with the mobile repo.

- [ ] **Step 3: Full verification**

Run: `npm run test` → all suites pass (including the OpenAPI snapshot). `npx tsc --noEmit` → clean.

- [ ] **Step 4: Merge and push** (standing rule: verified → merge to `main` + push). The migration is additive and **not applied by deploy**; until it is applied, `POST /devices` will 500 on the missing columns — acceptable because no client calls it yet.

- [ ] **Step 5: Ask, then apply the migration** — say exactly: "About to apply `20260918210000_fcm_tokens_platform.sql` (adds two nullable/defaulted columns to `fcm_tokens`; the web push route is unaffected). OK?" On approval use `mcp__claude_ai_Supabase__apply_migration`, then `list_migrations` and reconcile the recorded version with the filename if they differ (ask before repairing).

- [ ] **Step 6: Live round-trip (read-only, no writes)**

`curl -s https://sentinelxesports.com.ng/api/mobile/v1/config` → Expected: `{"data":{"minSupportedAppVersion":"0.0.0",…}}` and header `x-api-version: 1`.
`curl -s -o /dev/null -w "%{http_code}" https://sentinelxesports.com.ng/api/mobile/v1/me` → Expected: `401`.
`curl -s https://sentinelxesports.com.ng/.well-known/assetlinks.json` → Expected: `[]` (until `ANDROID_CERT_SHA256` is set in Vercel from Plan 0C Task 7).
Authenticated `GET /me` is exercised from the Flutter app in Plan 0C Task 8.

---

## Self-Review

**Spec coverage.** §7.2 conventions (base path, bearer via `getUser`, envelope, version handshake, contract generation) → Tasks 1–4. §6.11 `/config` → Task 5 (minus `paystackPublicKey`, corrected above). §6.10 error reporting into `client_error_logs` → Task 6. §6.2 device registration via service role, never direct `fcm_tokens` writes → Task 7. §6.1 App Links → Task 8. Role-aware app (`/me` returns roles) → Task 6. Explicit deferrals: idempotency, rate limiting, `/session/start`, `/auth/signup`, uploads (listed in Global Constraints).

**Placeholder scan.** No TBD/TODO; every code step is literal.

**Type consistency.** `MobileCtx` (Task 2) fields are used identically in Tasks 3, 6, 7. `Endpoint`/`EndpointMeta` (Task 3) are what `buildOpenApi` (Task 4) and `ALL_ENDPOINTS` consume. `registerDevice(admin, userId, body)` matches its test and endpoint. `Errors.*`/`errorBody` names are identical in Tasks 1–3. Env var names are identical in Task 5, Task 3 (`MOBILE_MIN_APP_VERSION`) and Task 9.

**Known limits.** `POST /errors` is unauthenticated and service-role-backed: size-capped by zod but not rate-limited (spam risk); rate limiting arrives with Phase 1 alongside auth endpoints. `openapi` snapshot regeneration uses vitest's `-u`, which also rewrites any other stale snapshot in that file — acceptable because it is the only snapshot file.
