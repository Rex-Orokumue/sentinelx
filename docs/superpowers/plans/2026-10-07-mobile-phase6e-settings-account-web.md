# Mobile Phase 6e — Settings and account completion (web API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the nine `/api/mobile/v1` operations Phase 6e needs (account read, deletion x3, phone x2, email change, Google unlink, locale), each backed by a service shared with the web server action it mirrors.

**Architecture:** Each web server action's logic moves into a plain service (`perform*`) that takes explicit dependencies. The action and the new endpoint both call it, so behaviour cannot drift. Session-bound Supabase auth calls (`updateUser`, `unlinkIdentity`, `signOut`) go through an `AccountAuthPort`: a cookie-client adapter for the web and a bearer-token adapter (GoTrue REST) for mobile, because `ctx.userClient` carries a bearer header but no real session and those calls would throw `AuthSessionMissingError` on it.

**Tech Stack:** Next.js route handlers, `defineEndpoint` (zod), Supabase (`supabase-js`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-mobile-phase6e-settings-account-design.md`. Mobile consumer plan: `C:\Users\gorok\sentinelx_mobile\docs\superpowers\plans\2026-10-07-mobile-phase6e-settings-account-screens.md` (written after this one; it depends on the contract this plan produces).

## Global Constraints

- Phase 6e web work happens on branch `phase6e/settings-account` (create from `main`); merge and push to `origin/main` when green (owner preference).
- Writes go through the service-role `ctx.admin` only where the equivalent web code already does; the user id always comes from `ctx.userId`, never the body.
- Error bodies are `{ error: { code, message, fields?, details? } }`; `code` is stable and snake_case; messages are English fallbacks the app never shows.
- Deletion grace is `GRACE_DAYS = 15` (`lib/settings/grace.ts`). OTP: 6 digits, 10 min expiry (`CODE_TTL_MS`), 60 s resend cooldown, 5 attempts, plus the new daily cap of 10 codes per 24 h.
- Password-taking endpoints (`POST /me/email`, `DELETE /me/identities/google`) are limited to 5 attempts per 15 minutes per user (`reauth:<userId>`).
- `LOCALES` is `['en','fr','pcm']` (`i18n/locales.ts`).
- Every new endpoint must be added to `ALL_ENDPOINTS` (`lib/mobile-api/endpoints/index.ts`) **and** have a route file under `app/api/mobile/v1/` (`route-files.test.ts` enforces it), then `npm run openapi` regenerates `openapi/mobile-v1.json`.
- `lib/supabase/types.ts` is generated; new tables are added by hand in the same shape until it is regenerated.
- Run before every commit: `npx vitest run <touched test files>`; before the final merge: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- Production Supabase (`itxubrkbropttfdackmi`) migrations are applied to **staging first**, then production, by the owner's permission rules; never test deletion or email change against production.

## Review Focus

- A Google-only user (no `email` identity) who set a password through the reset flow: `passwordIdentity` is `false` but `POST /me/email` with the right password must still succeed (no false `google_only`).
- WhatsApp unconfigured (`META_WHATSAPP_TOKEN` or `META_WHATSAPP_PHONE_NUMBER_ID` unset): mobile `POST /me/phone/code` must answer 503 `phone_unavailable` and write nothing; the web action must keep answering success.
- Two OTP requests inside 60 s, and the 11th request inside 24 h, must each be rejected with a `retryAfterSeconds` and must not send a message.
- `DELETE /me/deletion` for an account that is already tombstoned (`deleted_at` set) must not clear anything or error loudly.
- Delete-now with the username typed in different case, with surrounding spaces, or with the wrong name: only the case-insensitive trimmed exact match proceeds.
- Unlink with only one identity must answer `last_identity` without calling the provider, and unlink must revoke other sessions only after the identity is actually gone.
- `GET /me/account` must never return the unmasked phone number or the pending email of another user.
- `GET /me` gains `phoneVerifiedAt`; shipped app versions must keep parsing the response (the field is additive and nullable).

---

### Task 1: Rate-limit table and limiter

**Files:**
- Create: `supabase/migrations/20261007120000_account_rate_limit_events.sql`
- Modify: `lib/supabase/types.ts` (add `account_rate_limit_events` next to `chat_rate_limit_events`, ~line 344)
- Create: `lib/rate-limit/account-limiter.ts`
- Test: `lib/rate-limit/account-limiter.test.ts`

**Interfaces:**
- Produces: `hitLimit(admin, { key, limit, windowMs, now? }): Promise<{ allowed: boolean; retryAfterSeconds: number }>`; `OTP_DAILY_LIMIT = { limit: 10, windowMs: 86_400_000 }`; `REAUTH_LIMIT = { limit: 5, windowMs: 900_000 }`; `otpKey(userId)`, `reauthKey(userId)`.

- [ ] **Step 1: Write the migration**

```sql
-- Sliding-window ledger for per-user limits on account actions that cost money
-- (WhatsApp OTP sends) or are password-guess oracles (email change, unlink).
-- Service-role only, same pattern as chat_rate_limit_events. Rows hold only a
-- subject key and a timestamp and are pruned after 2 days (the longest window
-- is 24 h); anonymise_account is deliberately not changed for them.
CREATE TABLE public.account_rate_limit_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_key text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_rate_limit_events_subject_created_idx
  ON public.account_rate_limit_events (subject_key, created_at);
ALTER TABLE public.account_rate_limit_events ENABLE ROW LEVEL SECURITY;

SELECT cron.schedule(
  'prune-account-rate-limit-events',
  '10 3 * * *',
  $$ DELETE FROM public.account_rate_limit_events WHERE created_at < now() - interval '2 days' $$
);
```

- [ ] **Step 2: Add the generated-type block** in `lib/supabase/types.ts`, immediately before `chat_rate_limit_events: {` (alphabetical order puts it first among `a…`; place it where the tables starting with `a` are):

```ts
      account_rate_limit_events: {
        Row: {
          created_at: string
          id: string
          subject_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          subject_key: string
        }
        Update: {
          created_at?: string
          id?: string
          subject_key?: string
        }
        Relationships: []
      }
```

- [ ] **Step 3: Write the failing tests**

```ts
// lib/rate-limit/account-limiter.test.ts
import { describe, it, expect } from 'vitest'
import { hitLimit } from './account-limiter'

interface Row { id: string; subject_key: string; created_at: string }

function fakeAdmin(rows: Row[]) {
  let n = 0
  const admin = {
    from: (table: string) => {
      if (table !== 'account_rate_limit_events') throw new Error(`unexpected table ${table}`)
      return {
        insert: (row: { subject_key: string; created_at?: string }) => ({
          select: () => ({
            single: async () => {
              const r: Row = { id: `r${++n}`, subject_key: row.subject_key, created_at: row.created_at ?? new Date().toISOString() }
              rows.push(r)
              return { data: { id: r.id }, error: null }
            },
          }),
        }),
        select: () => ({
          eq: (_c: string, key: string) => ({
            gte: (_c2: string, since: string) => ({
              order: async () => ({
                data: rows
                  .filter((r) => r.subject_key === key && r.created_at >= since)
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map(({ created_at }) => ({ created_at })),
                error: null,
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: async (_c: string, id: string) => {
            const i = rows.findIndex((r) => r.id === id)
            if (i >= 0) rows.splice(i, 1)
            return { error: null }
          },
        }),
      }
    },
  }
  return admin as never
}

const T0 = new Date('2026-10-07T10:00:00.000Z')
const at = (sec: number) => new Date(T0.getTime() + sec * 1000)

describe('hitLimit', () => {
  it('allows hits up to the limit', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) {
      const r = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
      expect(r.allowed).toBe(true)
    }
  })

  it('blocks the hit after the limit, without counting the blocked attempt', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
    const blocked = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(3) })
    expect(blocked.allowed).toBe(false)
    expect(rows).toHaveLength(3)
  })

  it('reports when the oldest hit leaves the window', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
    const blocked = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(10) })
    // oldest hit at t=0 expires at t=60 -> 50 s from t=10
    expect(blocked.retryAfterSeconds).toBe(50)
  })

  it('allows again once old hits age out', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(i) })
    const later = await hitLimit(admin, { key: 'k', limit: 3, windowMs: 60_000, now: at(65) })
    expect(later.allowed).toBe(true)
  })

  it('keeps subjects independent', async () => {
    const rows: Row[] = []
    const admin = fakeAdmin(rows)
    for (let i = 0; i < 3; i++) await hitLimit(admin, { key: 'a', limit: 3, windowMs: 60_000, now: at(i) })
    const other = await hitLimit(admin, { key: 'b', limit: 3, windowMs: 60_000, now: at(4) })
    expect(other.allowed).toBe(true)
  })
})
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run lib/rate-limit/account-limiter.test.ts`
Expected: FAIL (`Cannot find module './account-limiter'`).

- [ ] **Step 5: Implement**

```ts
// lib/rate-limit/account-limiter.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export const OTP_DAILY_LIMIT = { limit: 10, windowMs: 86_400_000 } as const
export const REAUTH_LIMIT = { limit: 5, windowMs: 900_000 } as const

export const otpKey = (userId: string) => `otp:${userId}`
export const reauthKey = (userId: string) => `reauth:${userId}`

export interface LimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

// Insert first, then count the window, so two concurrent requests cannot both read
// "one left" (the chat limiter counts then inserts and can be raced). A rejected
// attempt's row is removed again so a blocked user is not locked out for longer by
// retrying.
//
// Fails OPEN if the ledger is unreachable: the callers either cost a WhatsApp message
// (bounded by the 60 s cooldown and 5 attempts) or sit behind Supabase's own
// signInWithPassword rate limit, and a ledger outage must not stop players verifying.
export async function hitLimit(
  admin: Admin,
  args: { key: string; limit: number; windowMs: number; now?: Date },
): Promise<LimitResult> {
  const now = args.now ?? new Date()
  const { data: inserted, error: insertError } = await admin
    .from('account_rate_limit_events')
    .insert({ subject_key: args.key, created_at: now.toISOString() })
    .select('id')
    .single()
  if (insertError || !inserted) {
    console.error('[account-limiter] insert failed', { message: insertError?.message })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const since = new Date(now.getTime() - args.windowMs).toISOString()
  const { data: rows, error: readError } = await admin
    .from('account_rate_limit_events')
    .select('created_at')
    .eq('subject_key', args.key)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  if (readError || !rows) {
    console.error('[account-limiter] read failed', { message: readError?.message })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (rows.length <= args.limit) return { allowed: true, retryAfterSeconds: 0 }

  await admin.from('account_rate_limit_events').delete().eq('id', inserted.id)
  const oldest = new Date(rows[0].created_at).getTime()
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((oldest + args.windowMs - now.getTime()) / 1000)),
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run lib/rate-limit/account-limiter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261007120000_account_rate_limit_events.sql lib/supabase/types.ts lib/rate-limit
git commit -m "feat(rate-limit): per-user sliding-window ledger for OTP and re-auth limits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Bearer-session GoTrue helper

**Files:**
- Create: `lib/mobile-api/gotrue-user.ts`
- Test: `lib/mobile-api/gotrue-user.test.ts`

**Interfaces:**
- Produces: `createGoTrueUserApi(accessToken: string, fetchImpl?: typeof fetch)` returning `{ updateEmail(email): Promise<GoTrueResult>; unlinkIdentity(identityId): Promise<GoTrueResult>; signOutOthers(): Promise<GoTrueResult> }`, with `GoTrueResult = { ok: true } | { ok: false; error: { status: number; code: string | null; message: string } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/mobile-api/gotrue-user.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGoTrueUserApi } from './gotrue-user'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
})

function fetchReturning(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('createGoTrueUserApi', () => {
  it('updateEmail PUTs /user with the bearer and apikey headers', async () => {
    const f = fetchReturning(200)
    const r = await createGoTrueUserApi('tok', f).updateEmail('new@example.com')
    expect(r).toEqual({ ok: true })
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/auth/v1/user')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', apikey: 'anon-key' })
    expect(JSON.parse(init.body as string)).toEqual({ email: 'new@example.com' })
  })

  it('unlinkIdentity DELETEs the encoded identity id', async () => {
    const f = fetchReturning(204)
    await createGoTrueUserApi('tok', f).unlinkIdentity('a/b')
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/auth/v1/user/identities/a%2Fb')
    expect(init.method).toBe('DELETE')
  })

  it('signOutOthers POSTs /logout?scope=others', async () => {
    const f = fetchReturning(204)
    await createGoTrueUserApi('tok', f).signOutOthers()
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/auth/v1/logout?scope=others')
    expect(init.method).toBe('POST')
  })

  it('maps a GoTrue error to status, error_code and message', async () => {
    const f = fetchReturning(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' })
    const r = await createGoTrueUserApi('tok', f).updateEmail('x@example.com')
    expect(r).toEqual({ ok: false, error: { status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' } })
  })

  it('survives a non-JSON error body', async () => {
    const f = vi.fn(async () => new Response('Bad Gateway', { status: 502 })) as unknown as typeof fetch
    const r = await createGoTrueUserApi('tok', f).signOutOthers()
    expect(r).toMatchObject({ ok: false, error: { status: 502, code: null } })
  })

  it('treats a network failure as a failed result, not a throw', async () => {
    const f = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const r = await createGoTrueUserApi('tok', f).signOutOthers()
    expect(r).toMatchObject({ ok: false, error: { status: 0, message: 'offline' } })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run lib/mobile-api/gotrue-user.test.ts`
Expected: FAIL (`Cannot find module './gotrue-user'`).

- [ ] **Step 3: Implement**

```ts
// lib/mobile-api/gotrue-user.ts

// Session-scoped GoTrue calls made with the caller's own access token.
//
// ctx.userClient cannot do these: it carries the bearer in a global header but has no
// session (persistSession is off), so supabase-js's updateUser / unlinkIdentity / signOut
// throw AuthSessionMissingError on it. The REST endpoints accept the bearer directly.
export interface GoTrueError {
  status: number
  code: string | null
  message: string
}
export type GoTrueResult = { ok: true } | { ok: false; error: GoTrueError }

export function createGoTrueUserApi(accessToken: string, fetchImpl: typeof fetch = fetch) {
  async function call(method: 'PUT' | 'DELETE' | 'POST', path: string, body?: unknown): Promise<GoTrueResult> {
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.ok) return { ok: true }
      let payload: { error_code?: unknown; code?: unknown; msg?: unknown; message?: unknown } = {}
      try {
        payload = (await res.json()) as typeof payload
      } catch {
        // non-JSON error body: fall through with status text
      }
      const code =
        typeof payload.error_code === 'string' ? payload.error_code : typeof payload.code === 'string' ? payload.code : null
      const message =
        typeof payload.msg === 'string' ? payload.msg : typeof payload.message === 'string' ? payload.message : res.statusText
      return { ok: false, error: { status: res.status, code, message } }
    } catch (e) {
      return { ok: false, error: { status: 0, code: null, message: e instanceof Error ? e.message : String(e) } }
    }
  }

  return {
    updateEmail: (email: string) => call('PUT', '/user', { email }),
    unlinkIdentity: (identityId: string) => call('DELETE', `/user/identities/${encodeURIComponent(identityId)}`),
    signOutOthers: () => call('POST', '/logout?scope=others'),
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run lib/mobile-api/gotrue-user.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/mobile-api/gotrue-user.ts lib/mobile-api/gotrue-user.test.ts
git commit -m "feat(mobile-api): bearer-token GoTrue helper for session-scoped auth calls

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Account auth port, email-change service, unlink service

**Files:**
- Create: `lib/auth/account-auth-port.ts`, `lib/auth/email-change-service.ts`, `lib/auth/unlink-google-service.ts`
- Modify: `lib/auth/actions.ts` (`changeEmail`, lines ~158-222), `lib/auth/identities.ts`
- Test: `lib/auth/email-change-service.test.ts`, `lib/auth/unlink-google-service.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `hasPasswordIdentity` (`lib/auth/reauth.ts`); `isIdentifierBanned` (`lib/auth/signup-blocks.ts`); `createGoTrueUserApi` (Task 2).
- Produces:
  - `AccountAuthPort { listIdentities(): Promise<AccountIdentity[] | null>; updateEmail(email): Promise<PortError | null>; unlinkIdentity(identityId): Promise<PortError | null>; signOutOthers(): Promise<void> }`, `AccountIdentity = { identityId: string; provider: string }`, `PortError = { code: string | null; message: string }`
  - `supabaseSessionPort(supabase)`, `bearerPort({ accessToken, userId, admin })`
  - `performChangeEmail({ port, user, input, deps }): Promise<ChangeEmailOutcome>`; `ChangeEmailErrorCode`
  - `performUnlinkGoogle({ port, user, password, verifyPassword }): Promise<UnlinkOutcome>`; `UnlinkErrorCode`

- [ ] **Step 1: Write the port**

```ts
// lib/auth/account-auth-port.ts
import type { SupabaseClient, UserIdentity } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { createGoTrueUserApi } from '@/lib/mobile-api/gotrue-user'

export interface AccountIdentity {
  identityId: string
  provider: string
}
export interface PortError {
  code: string | null
  message: string
}

// The session-bound auth operations the account services need. Two adapters because the
// web holds a cookie session and mobile holds only a verified bearer token.
export interface AccountAuthPort {
  listIdentities(): Promise<AccountIdentity[] | null>
  updateEmail(email: string): Promise<PortError | null>
  unlinkIdentity(identityId: string): Promise<PortError | null>
  signOutOthers(): Promise<void>
}

const toPortError = (e: { message: string }): PortError => ({
  code: (e as { code?: string }).code ?? null,
  message: e.message,
})

export function supabaseSessionPort(supabase: SupabaseClient<Database>): AccountAuthPort {
  let raw: UserIdentity[] = []
  return {
    async listIdentities() {
      const { data, error } = await supabase.auth.getUserIdentities()
      if (error || !data) return null
      raw = data.identities
      return raw.map((i) => ({ identityId: i.identity_id, provider: i.provider }))
    },
    async updateEmail(email) {
      const { error } = await supabase.auth.updateUser({ email })
      return error ? toPortError(error) : null
    },
    async unlinkIdentity(identityId) {
      const identity = raw.find((i) => i.identity_id === identityId)
      if (!identity) return { code: 'identity_not_found', message: 'identity not found' }
      const { error } = await supabase.auth.unlinkIdentity(identity)
      return error ? toPortError(error) : null
    },
    async signOutOthers() {
      await supabase.auth.signOut({ scope: 'others' })
    },
  }
}

export function bearerPort(args: {
  accessToken: string
  userId: string
  admin: ReturnType<typeof createAdminClient>
  api?: ReturnType<typeof createGoTrueUserApi>
}): AccountAuthPort {
  const api = args.api ?? createGoTrueUserApi(args.accessToken)
  const fromResult = (r: Awaited<ReturnType<typeof api.updateEmail>>): PortError | null =>
    r.ok ? null : { code: r.error.code, message: r.error.message }
  return {
    async listIdentities() {
      const { data, error } = await args.admin.auth.admin.getUserById(args.userId)
      if (error || !data.user) return null
      return (data.user.identities ?? []).map((i) => ({ identityId: i.identity_id, provider: i.provider }))
    },
    async updateEmail(email) {
      return fromResult(await api.updateEmail(email))
    },
    async unlinkIdentity(identityId) {
      return fromResult(await api.unlinkIdentity(identityId))
    },
    async signOutOthers() {
      await api.signOutOthers()
    },
  }
}
```

- [ ] **Step 2: Write the failing email-change tests**

```ts
// lib/auth/email-change-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performChangeEmail } from './email-change-service'
import type { AccountAuthPort } from './account-auth-port'

function port(over: Partial<AccountAuthPort> = {}): AccountAuthPort {
  return {
    listIdentities: vi.fn(async () => []),
    updateEmail: vi.fn(async () => null),
    unlinkIdentity: vi.fn(async () => null),
    signOutOthers: vi.fn(async () => {}),
    ...over,
  }
}
const google = { identities: [{ provider: 'google' }] } as never
const withEmail = { identities: [{ provider: 'email' }] } as never
const deps = (over: Partial<{ verifyPassword: (e: string, p: string) => Promise<boolean>; isBanned: (e: string) => Promise<boolean> }> = {}) => ({
  verifyPassword: vi.fn(async () => true),
  isBanned: vi.fn(async () => false),
  ...over,
})
const input = { email: 'New@Example.com', password: 'pw' }

describe('performChangeEmail', () => {
  it('requires a session email', async () => {
    const r = await performChangeEmail({ port: port(), user: { email: null }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'not_logged_in' })
  })

  it('rejects the current address regardless of case', async () => {
    const r = await performChangeEmail({ port: port(), user: { email: 'new@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'same_email' })
  })

  it('wrong password with a password identity is wrong_password', async () => {
    const r = await performChangeEmail({
      port: port(),
      user: { email: 'a@example.com', identities: withEmail },
      input,
      deps: deps({ verifyPassword: vi.fn(async () => false) }),
    })
    expect(r).toEqual({ ok: false, errorCode: 'wrong_password' })
  })

  it('wrong password without a password identity is google_only', async () => {
    const r = await performChangeEmail({
      port: port(),
      user: { email: 'a@example.com', identities: google },
      input,
      deps: deps({ verifyPassword: vi.fn(async () => false) }),
    })
    expect(r).toEqual({ ok: false, errorCode: 'google_only' })
  })

  it('a Google-only user whose reset-flow password is correct still succeeds', async () => {
    const p = port()
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: google }, input, deps: deps() })
    expect(r).toEqual({ ok: true, sentTo: 'new@example.com' })
    expect(p.updateEmail).toHaveBeenCalledWith('new@example.com')
  })

  it('blocks a banned address before asking the provider', async () => {
    const p = port()
    const r = await performChangeEmail({
      port: p,
      user: { email: 'a@example.com', identities: withEmail },
      input,
      deps: deps({ isBanned: vi.fn(async () => true) }),
    })
    expect(r).toEqual({ ok: false, errorCode: 'email_banned' })
    expect(p.updateEmail).not.toHaveBeenCalled()
  })

  it('treats a send rate limit as already sent', async () => {
    const p = port({ updateEmail: vi.fn(async () => ({ code: 'over_email_send_rate_limit', message: 'slow' })) })
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: true, sentTo: 'new@example.com' })
  })

  it.each([
    [{ code: 'email_exists', message: 'x' }],
    [{ code: null, message: 'A user has already been registered' }],
  ])('maps a taken address to email_in_use (%o)', async (err) => {
    const p = port({ updateEmail: vi.fn(async () => err) })
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'email_in_use' })
  })

  it('maps any other provider failure to failed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = port({ updateEmail: vi.fn(async () => ({ code: 'unexpected', message: 'boom' })) })
    const r = await performChangeEmail({ port: p, user: { email: 'a@example.com', identities: withEmail }, input, deps: deps() })
    expect(r).toEqual({ ok: false, errorCode: 'failed' })
    spy.mockRestore()
  })
})
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run lib/auth/email-change-service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement the email-change service**

```ts
// lib/auth/email-change-service.ts
import type { User } from '@supabase/supabase-js'
import { hasPasswordIdentity } from './reauth'
import type { AccountAuthPort } from './account-auth-port'

export type ChangeEmailErrorCode =
  | 'invalid_email'
  | 'password_required'
  | 'not_logged_in'
  | 'same_email'
  | 'wrong_password'
  | 'google_only'
  | 'email_banned'
  | 'email_in_use'
  | 'failed'

export type ChangeEmailOutcome = { ok: true; sentTo: string } | { ok: false; errorCode: ChangeEmailErrorCode }

export interface ChangeEmailDeps {
  verifyPassword: (email: string, password: string) => Promise<boolean>
  isBanned: (email: string) => Promise<boolean>
}

// Extracted from lib/auth/actions.ts changeEmail(); the action and POST /me/email both call it.
// The order is load-bearing and unchanged: same-address check, password (before concluding
// there isn't one), ban blocklist, then the provider. See the comments on changeEmail's
// history: a Google user who set a password through the reset flow has no 'email' identity,
// so the identity list is only consulted AFTER the password has failed.
export async function performChangeEmail(args: {
  port: AccountAuthPort
  user: { email?: string | null; identities?: User['identities'] }
  input: { email: string; password: string }
  deps: ChangeEmailDeps
}): Promise<ChangeEmailOutcome> {
  const email = args.input.email.toLowerCase()
  const current = args.user.email
  if (!current) return { ok: false, errorCode: 'not_logged_in' }
  if (email === current.toLowerCase()) return { ok: false, errorCode: 'same_email' }

  if (!(await args.deps.verifyPassword(current, args.input.password))) {
    return { ok: false, errorCode: hasPasswordIdentity({ identities: args.user.identities }) ? 'wrong_password' : 'google_only' }
  }

  if (await args.deps.isBanned(email)) return { ok: false, errorCode: 'email_banned' }

  const error = await args.port.updateEmail(email)
  if (!error) return { ok: true, sentTo: email }

  // They asked seconds ago and a link is already in flight.
  if (error.code === 'over_email_send_rate_limit') return { ok: true, sentTo: email }
  if (error.code === 'email_exists' || /already been registered/i.test(error.message)) {
    return { ok: false, errorCode: 'email_in_use' }
  }
  console.error('[changeEmail] updateUser failed', { code: error.code, message: error.message })
  return { ok: false, errorCode: 'failed' }
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run lib/auth/email-change-service.test.ts`
Expected: PASS (9 tests including the 2 `it.each` rows).

- [ ] **Step 6: Write the failing unlink tests**

```ts
// lib/auth/unlink-google-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performUnlinkGoogle } from './unlink-google-service'
import type { AccountAuthPort } from './account-auth-port'

const both = [
  { identityId: 'i-email', provider: 'email' },
  { identityId: 'i-google', provider: 'google' },
]
function port(over: Partial<AccountAuthPort> = {}): AccountAuthPort {
  return {
    listIdentities: vi.fn(async () => both),
    updateEmail: vi.fn(async () => null),
    unlinkIdentity: vi.fn(async () => null),
    signOutOthers: vi.fn(async () => {}),
    ...over,
  }
}
const ok = vi.fn(async () => true)

describe('performUnlinkGoogle', () => {
  it('requires a password', async () => {
    const r = await performUnlinkGoogle({ port: port(), user: { email: 'a@example.com' }, password: '', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'password_required' })
  })

  it('requires a session email', async () => {
    const r = await performUnlinkGoogle({ port: port(), user: { email: null }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'not_logged_in' })
  })

  it('rejects a wrong password before touching identities', async () => {
    const p = port()
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: vi.fn(async () => false) })
    expect(r).toEqual({ ok: false, errorCode: 'wrong_password' })
    expect(p.listIdentities).not.toHaveBeenCalled()
  })

  it('reports not_linked when Google is absent', async () => {
    const p = port({ listIdentities: vi.fn(async () => [{ identityId: 'i', provider: 'email' }, { identityId: 'j', provider: 'github' }]) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'not_linked' })
  })

  it('refuses the last identity without calling the provider', async () => {
    const p = port({ listIdentities: vi.fn(async () => [{ identityId: 'i-google', provider: 'google' }]) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'last_identity' })
    expect(p.unlinkIdentity).not.toHaveBeenCalled()
  })

  it('fails when identities cannot be listed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = port({ listIdentities: vi.fn(async () => null) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'failed' })
    spy.mockRestore()
  })

  it('maps manual_linking_disabled to unavailable and does not revoke sessions', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = port({ unlinkIdentity: vi.fn(async () => ({ code: 'manual_linking_disabled', message: 'off' })) })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: false, errorCode: 'unavailable' })
    expect(p.signOutOthers).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('unlinks the Google identity, then revokes other sessions', async () => {
    const order: string[] = []
    const p = port({
      unlinkIdentity: vi.fn(async () => { order.push('unlink'); return null }),
      signOutOthers: vi.fn(async () => { order.push('signOutOthers') }),
    })
    const r = await performUnlinkGoogle({ port: p, user: { email: 'a@example.com' }, password: 'pw', verifyPassword: ok })
    expect(r).toEqual({ ok: true })
    expect(p.unlinkIdentity).toHaveBeenCalledWith('i-google')
    expect(order).toEqual(['unlink', 'signOutOthers'])
  })
})
```

- [ ] **Step 7: Run and confirm failure**

Run: `npx vitest run lib/auth/unlink-google-service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 8: Implement the unlink service**

```ts
// lib/auth/unlink-google-service.ts
import type { AccountAuthPort } from './account-auth-port'

export type UnlinkErrorCode =
  | 'password_required'
  | 'not_logged_in'
  | 'wrong_password'
  | 'not_linked'
  | 'last_identity'
  | 'unavailable'
  | 'failed'

export type UnlinkOutcome = { ok: true } | { ok: false; errorCode: UnlinkErrorCode }

// Extracted from lib/auth/identities.ts unlinkGoogle(). The password does two jobs: it proves
// the session belongs to the account holder, and it proves a working password exists so removing
// Google cannot strand the account. Other sessions are revoked only after the identity is
// actually gone: unlinking is a "lock the other person out" action.
export async function performUnlinkGoogle(args: {
  port: AccountAuthPort
  user: { email?: string | null }
  password: string
  verifyPassword: (email: string, password: string) => Promise<boolean>
}): Promise<UnlinkOutcome> {
  if (!args.password) return { ok: false, errorCode: 'password_required' }
  if (!args.user.email) return { ok: false, errorCode: 'not_logged_in' }
  if (!(await args.verifyPassword(args.user.email, args.password))) return { ok: false, errorCode: 'wrong_password' }

  const identities = await args.port.listIdentities()
  if (!identities) {
    console.error('[unlinkGoogle] listing identities failed')
    return { ok: false, errorCode: 'failed' }
  }
  const google = identities.find((i) => i.provider === 'google')
  if (!google) return { ok: false, errorCode: 'not_linked' }
  if (identities.length < 2) return { ok: false, errorCode: 'last_identity' }

  const error = await args.port.unlinkIdentity(google.identityId)
  if (error) {
    console.error('[unlinkGoogle] unlinkIdentity failed', { code: error.code, message: error.message })
    // Both link and unlink sit behind the project's Manual Linking toggle; retrying cannot help.
    if (error.code === 'manual_linking_disabled') return { ok: false, errorCode: 'unavailable' }
    return { ok: false, errorCode: 'failed' }
  }

  await args.port.signOutOthers()
  return { ok: true }
}
```

- [ ] **Step 9: Run both service test files**

Run: `npx vitest run lib/auth/email-change-service.test.ts lib/auth/unlink-google-service.test.ts`
Expected: PASS.

- [ ] **Step 10: Refactor the two web actions to delegate**

In `lib/auth/actions.ts`, add imports `import { supabaseSessionPort } from './account-auth-port'` and `import { performChangeEmail } from './email-change-service'`, then replace the body of `changeEmail` after the zod parse (from `const email = parsed.data.email.toLowerCase()` to the final `return { sentTo: email }`) with:

```ts
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { errorCode: 'not_logged_in' }

  const result = await performChangeEmail({
    port: supabaseSessionPort(supabase),
    user,
    input: parsed.data,
    deps: {
      verifyPassword,
      isBanned: (value) => isIdentifierBanned(createAdminClient(), value),
    },
  })
  if (!result.ok) return { errorCode: result.errorCode }

  // Repaints the settings page so the pending-address row appears without a manual reload.
  revalidatePath('/dashboard/settings')
  return { sentTo: result.sentTo }
```

Keep the long explanatory comment block above `changeEmail` and remove only the now-unused `hasPasswordIdentity` import if nothing else in the file uses it (`grep -n hasPasswordIdentity lib/auth/actions.ts`).

In `lib/auth/identities.ts`, replace the body of `unlinkGoogle` and the local `UnlinkErrorCode` type with:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { verifyPassword } from './reauth'
import { supabaseSessionPort } from './account-auth-port'
import { performUnlinkGoogle, type UnlinkErrorCode } from './unlink-google-service'

export type { UnlinkErrorCode }
export type UnlinkState = { errorCode?: UnlinkErrorCode; unlinked?: boolean } | undefined

export async function unlinkGoogle(_prev: UnlinkState, formData: FormData): Promise<UnlinkState> {
  const password = String(formData.get('password') ?? '')
  if (!password) return { errorCode: 'password_required' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const result = await performUnlinkGoogle({ port: supabaseSessionPort(supabase), user: { email: user?.email }, password, verifyPassword })
  if (!result.ok) return { errorCode: result.errorCode }

  revalidatePath('/dashboard/settings')
  return { unlinked: true }
}
```

Keep the header comment explaining why unlinking exists (move it above the function).

- [ ] **Step 11: Run existing auth tests and typecheck**

Run: `npx vitest run lib/auth && npx tsc --noEmit`
Expected: PASS, no type errors (fix any `UserIdentity.identity_id` typing by confirming the installed `@supabase/supabase-js` version exposes it; it does from 2.40+).

- [ ] **Step 12: Commit**

```bash
git add lib/auth
git commit -m "refactor(auth): extract email-change and Google-unlink services behind an auth port

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Deletion flow service

**Files:**
- Create: `lib/settings/deletion-flow.ts`
- Modify: `lib/settings/account.ts`
- Test: `lib/settings/deletion-flow.test.ts`

**Interfaces:**
- Consumes: `checkCanDelete`/`DeletionBlocker` (`deletion-guards.ts`), `fetchGuardInput`/`executeDeletion` (`deletion-service.ts`), `deletionDueAt` (`grace.ts`), `sendEmail`, `SITE_URL`.
- Produces:
  - `performRequestDeletion(admin, user: { id: string; email: string | null }, now?: Date): Promise<{ ok: true; requestedAt: Date; dueAt: Date } | { ok: false; reason: 'blocked'; blockers: DeletionBlocker[] } | { ok: false; reason: 'save_failed' }>`
  - `performCancelDeletion(admin, user): Promise<{ ok: true } | { ok: false }>`
  - `performDeleteNow(admin, userId, typedUsername): Promise<{ ok: true } | { ok: false; reason: 'username_mismatch' } | { ok: false; reason: 'blocked'; blockers: DeletionBlocker[] }>`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/settings/deletion-flow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./deletion-service', () => ({ fetchGuardInput: vi.fn(), executeDeletion: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => {}) }))

import { fetchGuardInput, executeDeletion } from './deletion-service'
import { sendEmail } from '@/lib/email/send'
import { performRequestDeletion, performCancelDeletion, performDeleteNow } from './deletion-flow'

const clean = { walletBalance: 0, pendingWithdrawals: 0, openEscrowOrders: 0, activeListings: 0, activeTournaments: 0, unfinishedMatches: 0, unfinishedFriendlies: 0 }

function adminWith(opts: { updateError?: boolean; username?: string | null; onUpdate?: (patch: unknown) => void; onIs?: (col: string, v: unknown) => void } = {}) {
  return {
    from: () => ({
      update: (patch: unknown) => {
        opts.onUpdate?.(patch)
        const chain = {
          eq: () => chain,
          is: (col: string, v: unknown) => { opts.onIs?.(col, v); return Promise.resolve({ error: opts.updateError ? { message: 'x' } : null }) },
          then: (res: (v: unknown) => void) => res({ error: opts.updateError ? { message: 'x' } : null }),
        }
        return chain
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.username === undefined ? { username: 'Rex' } : opts.username === null ? null : { username: opts.username } }) }) }),
    }),
  } as never
}

beforeEach(() => {
  vi.mocked(fetchGuardInput).mockResolvedValue(clean)
  vi.mocked(executeDeletion).mockResolvedValue({ ok: true })
  vi.mocked(sendEmail).mockClear()
})

describe('performRequestDeletion', () => {
  const now = new Date('2026-10-07T00:00:00.000Z')

  it('returns every blocker and does not write', async () => {
    vi.mocked(fetchGuardInput).mockResolvedValue({ ...clean, walletBalance: 500, activeListings: 2 })
    const onUpdate = vi.fn()
    const r = await performRequestDeletion(adminWith({ onUpdate }), { id: 'u1', email: 'a@example.com' }, now)
    expect(r).toEqual({ ok: false, reason: 'blocked', blockers: [{ code: 'wallet_balance', amount: 500 }, { code: 'active_listing', count: 2 }] })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('stamps the request, computes the due date 15 days out and emails', async () => {
    const onUpdate = vi.fn()
    const r = await performRequestDeletion(adminWith({ onUpdate }), { id: 'u1', email: 'a@example.com' }, now)
    expect(onUpdate).toHaveBeenCalledWith({ deletion_requested_at: now.toISOString() })
    expect(r).toEqual({ ok: true, requestedAt: now, dueAt: new Date('2026-10-22T00:00:00.000Z') })
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('skips the email when the account has none', async () => {
    await performRequestDeletion(adminWith(), { id: 'u1', email: null }, now)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reports save_failed without emailing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await performRequestDeletion(adminWith({ updateError: true }), { id: 'u1', email: 'a@example.com' }, now)
    expect(r).toEqual({ ok: false, reason: 'save_failed' })
    expect(sendEmail).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('performCancelDeletion', () => {
  it('clears the request only on a not-yet-deleted profile', async () => {
    const onUpdate = vi.fn()
    const onIs = vi.fn()
    const r = await performCancelDeletion(adminWith({ onUpdate, onIs }), { id: 'u1', email: 'a@example.com' })
    expect(r).toEqual({ ok: true })
    expect(onUpdate).toHaveBeenCalledWith({ deletion_requested_at: null })
    expect(onIs).toHaveBeenCalledWith('deleted_at', null)
    expect(sendEmail).toHaveBeenCalledOnce()
  })

  it('reports failure without emailing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await performCancelDeletion(adminWith({ updateError: true }), { id: 'u1', email: 'a@example.com' })
    expect(r).toEqual({ ok: false })
    expect(sendEmail).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('performDeleteNow', () => {
  it.each(['rex', '  REX  ', 'Rex'])('accepts the username typed as %j', async (typed) => {
    const r = await performDeleteNow(adminWith(), 'u1', typed)
    expect(r).toEqual({ ok: true })
    expect(executeDeletion).toHaveBeenCalledWith(expect.anything(), 'u1')
  })

  it.each(['', 'Rexx', 'someone else', 'DELETE'])('rejects %j', async (typed) => {
    const r = await performDeleteNow(adminWith(), 'u1', typed)
    expect(r).toEqual({ ok: false, reason: 'username_mismatch' })
    expect(executeDeletion).not.toHaveBeenCalled()
  })

  it('rejects when the profile has no username', async () => {
    const r = await performDeleteNow(adminWith({ username: null }), 'u1', 'Rex')
    expect(r).toEqual({ ok: false, reason: 'username_mismatch' })
  })

  it('surfaces blockers from executeDeletion', async () => {
    vi.mocked(executeDeletion).mockResolvedValue({ ok: false, blockers: [{ code: 'pending_withdrawal', count: 1 }] })
    const r = await performDeleteNow(adminWith(), 'u1', 'Rex')
    expect(r).toEqual({ ok: false, reason: 'blocked', blockers: [{ code: 'pending_withdrawal', count: 1 }] })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run lib/settings/deletion-flow.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/settings/deletion-flow.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { checkCanDelete, type DeletionBlocker } from './deletion-guards'
import { fetchGuardInput, executeDeletion } from './deletion-service'
import { deletionDueAt } from './grace'
import { sendEmail } from '@/lib/email/send'
import { SITE_URL } from '@/lib/seo/site'

type Admin = SupabaseClient<Database>
const SETTINGS_URL = `${SITE_URL}/dashboard/settings`

export type RequestDeletionOutcome =
  | { ok: true; requestedAt: Date; dueAt: Date }
  | { ok: false; reason: 'blocked'; blockers: DeletionBlocker[] }
  | { ok: false; reason: 'save_failed' }

// Starts the 15-day grace period. Nothing is destroyed here: the account is only marked, and
// the user can cancel right up until the cron executes it. Extracted from account.ts
// requestAccountDeletion(); the action keeps the typed-DELETE check and revalidation.
export async function performRequestDeletion(
  admin: Admin,
  user: { id: string; email: string | null },
  now: Date = new Date(),
): Promise<RequestDeletionOutcome> {
  const blockers = checkCanDelete(await fetchGuardInput(admin, user.id))
  if (blockers.length > 0) return { ok: false, reason: 'blocked', blockers }

  const { error } = await admin.from('profiles').update({ deletion_requested_at: now.toISOString() }).eq('id', user.id)
  if (error) {
    console.error('requestAccountDeletion failed', error)
    return { ok: false, reason: 'save_failed' }
  }

  const due = deletionDueAt(now)
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account is scheduled for deletion',
      html:
        `<p>Your SentinelX Esports account is scheduled for deletion on ` +
        `<strong>${due.toDateString()}</strong>.</p>` +
        `<p>If you did not ask for this, or you change your mind, sign in and cancel: ` +
        `<a href="${SETTINGS_URL}">${SETTINGS_URL}</a></p>`,
    })
  }
  return { ok: true, requestedAt: now, dueAt: due }
}

export async function performCancelDeletion(
  admin: Admin,
  user: { id: string; email: string | null },
): Promise<{ ok: true } | { ok: false }> {
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', user.id)
    .is('deleted_at', null)
  if (error) {
    console.error('cancelAccountDeletion failed', error)
    return { ok: false }
  }
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account deletion was cancelled',
      html: '<p>Your account is no longer scheduled for deletion. Nothing was lost.</p>',
    })
  }
  return { ok: true }
}

export type DeleteNowOutcome =
  | { ok: true }
  | { ok: false; reason: 'username_mismatch' }
  | { ok: false; reason: 'blocked'; blockers: DeletionBlocker[] }

// Skips the grace period. Gated on typing the exact username (case-insensitive, trimmed): a
// higher bar than DELETE that works identically for password and Google accounts.
export async function performDeleteNow(admin: Admin, userId: string, typedUsername: string): Promise<DeleteNowOutcome> {
  const { data: profile } = await admin.from('profiles').select('username').eq('id', userId).maybeSingle()
  const typed = typedUsername.trim()
  if (!profile?.username || typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { ok: false, reason: 'username_mismatch' }
  }
  const result = await executeDeletion(admin, userId)
  if (!result.ok) return { ok: false, reason: 'blocked', blockers: result.blockers }
  return { ok: true }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run lib/settings/deletion-flow.test.ts`
Expected: PASS. If the `adminWith` chain double-handles `update().eq()` (awaited without `.is`), keep the `then` shim so `await admin.from().update().eq()` resolves.

- [ ] **Step 5: Refactor `lib/settings/account.ts` to delegate**

Replace the three actions' bodies, keeping signatures, the typed-confirm checks, the `'use server'` header, `DeleteAccountState` and `revalidatePath` calls:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DeletionBlocker } from './deletion-guards'
import { performRequestDeletion, performCancelDeletion, performDeleteNow } from './deletion-flow'

export type DeleteAccountState = { error?: string; blockers?: DeletionBlocker[] } | undefined

export async function requestAccountDeletion(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  if (formData.get('confirm') !== 'DELETE') return { error: 'Type DELETE to confirm.' }
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const result = await performRequestDeletion(createAdminClient(), { id: user.id, email: user.email ?? null })
  if (!result.ok) {
    return result.reason === 'blocked' ? { blockers: result.blockers } : { error: 'Could not schedule deletion. Please try again.' }
  }
  // The banner renders from the nav session in the root layout.
  revalidatePath('/', 'layout')
  return undefined
}

export async function cancelAccountDeletion(): Promise<DeleteAccountState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }
  const result = await performCancelDeletion(createAdminClient(), { id: user.id, email: user.email ?? null })
  if (!result.ok) return { error: 'Could not cancel. Please try again.' }
  revalidatePath('/', 'layout')
  return undefined
}

export async function deleteAccountNow(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }
  const result = await performDeleteNow(createAdminClient(), user.id, String(formData.get('confirm') ?? ''))
  if (!result.ok) {
    return result.reason === 'blocked' ? { blockers: result.blockers } : { error: 'That does not match your username.' }
  }
  revalidatePath('/', 'layout')
  return undefined
}
```

Keep the explanatory comments from the original above each action.

- [ ] **Step 6: Run settings tests and typecheck**

Run: `npx vitest run lib/settings && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/settings
git commit -m "refactor(settings): extract account deletion flow into a shared service

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Phone verification service

**Files:**
- Create: `lib/phone/service.ts`
- Modify: `lib/notifications/whatsapp-cloud-api.ts` (add `isWhatsAppOtpConfigured`), `lib/phone/actions.ts`
- Test: `lib/phone/service.test.ts`

**Interfaces:**
- Consumes: `toWhatsAppNumber` (`./number`), `sendWhatsAppOtp`, `phoneCodeSchema`, `hashCode`/`codeMatches`, `checkAndUnlockAchievements`, `hitLimit`/`OTP_DAILY_LIMIT`/`otpKey` (Task 1).
- Produces:
  - `isWhatsAppOtpConfigured(): boolean`
  - `performRequestPhoneCode({ admin, userId, rawPhone, strictDelivery, now? }): Promise<RequestPhoneCodeOutcome>` where `RequestPhoneCodeOutcome = { ok: true; expiresAt: string; resendAt: string } | { ok: false; reason: 'invalid_phone' | 'unavailable' | 'send_failed' | 'save_failed' } | { ok: false; reason: 'cooldown' | 'daily_limit'; retryAfterSeconds: number }`
  - `performConfirmPhoneCode({ admin, userId, code, now? }): Promise<{ ok: true; verifiedAt: string } | { ok: false; reason: 'invalid_code' | 'missing' | 'expired' | 'attempts_exceeded' | 'wrong' }>`
  - exported constants `CODE_TTL_MS = 600000`, `RESEND_COOLDOWN_MS = 60000`, `MAX_ATTEMPTS = 5`.

- [ ] **Step 1: Add the configuration helper**

In `lib/notifications/whatsapp-cloud-api.ts`, add above `sendWhatsAppOtp` and use it:

```ts
export function isWhatsAppOtpConfigured(): boolean {
  return Boolean(process.env.META_WHATSAPP_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID)
}
```

and change the existing guard line to `if (!token || !phoneNumberId) return { ok: false, skipped: true }` (unchanged), leaving `sendWhatsAppOtp`'s behaviour untouched.

- [ ] **Step 2: Write the failing tests**

```ts
// lib/phone/service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/whatsapp-cloud-api', () => ({ sendWhatsAppOtp: vi.fn(), isWhatsAppOtpConfigured: vi.fn() }))
vi.mock('@/lib/achievements/unlock', () => ({ checkAndUnlockAchievements: vi.fn(async () => {}) }))
vi.mock('@/lib/rate-limit/account-limiter', async (orig) => ({ ...(await orig<object>()), hitLimit: vi.fn() }))

import { sendWhatsAppOtp, isWhatsAppOtpConfigured } from '@/lib/notifications/whatsapp-cloud-api'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { hitLimit } from '@/lib/rate-limit/account-limiter'
import { hashCode } from './hash'
import { performRequestPhoneCode, performConfirmPhoneCode } from './service'

interface State {
  country: string | null
  pending: { phone: string; code_hash: string; attempts: number; expires_at: string; created_at: string } | null
  profileUpdates: unknown[]
  upserts: unknown[]
  deleted: number
  attemptWrites: unknown[]
}
function fakeAdmin(state: State) {
  return {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country: state.country } }) }) }),
          update: (patch: unknown) => ({ eq: async () => { state.profileUpdates.push(patch); return { error: null } } }),
        }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.pending }) }) }),
        upsert: async (row: unknown) => { state.upserts.push(row); return { error: null } },
        update: (patch: unknown) => ({ eq: async () => { state.attemptWrites.push(patch); return { error: null } } }),
        delete: () => ({ eq: async () => { state.deleted++; return { error: null } } }),
      }
    },
  } as never
}
const fresh = (): State => ({ country: 'NG', pending: null, profileUpdates: [], upserts: [], deleted: 0, attemptWrites: [] })
const NOW = new Date('2026-10-07T10:00:00.000Z')

beforeEach(() => {
  vi.mocked(isWhatsAppOtpConfigured).mockReturnValue(true)
  vi.mocked(sendWhatsAppOtp).mockResolvedValue({ ok: true })
  vi.mocked(hitLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  vi.mocked(checkAndUnlockAchievements).mockClear()
})

describe('performRequestPhoneCode', () => {
  it('rejects an unparseable number before any write or send', async () => {
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: 'abc', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'invalid_phone' })
    expect(s.upserts).toHaveLength(0)
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('enforces the 60 s resend cooldown with a retryAfterSeconds', async () => {
    const s = fresh()
    s.pending = { phone: '2348012345678', code_hash: 'h', attempts: 0, expires_at: '2099-01-01T00:00:00Z', created_at: new Date(NOW.getTime() - 20_000).toISOString() }
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'cooldown', retryAfterSeconds: 40 })
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('enforces the daily cap and does not send', async () => {
    vi.mocked(hitLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 })
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'daily_limit', retryAfterSeconds: 3600 })
    expect(s.upserts).toHaveLength(0)
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('stores a hashed code, sends it, and returns expiry and resend times', async () => {
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: true, expiresAt: new Date(NOW.getTime() + 600_000).toISOString(), resendAt: new Date(NOW.getTime() + 60_000).toISOString() })
    const row = s.upserts[0] as { user_id: string; phone: string; code_hash: string; attempts: number }
    expect(row).toMatchObject({ user_id: 'u1', attempts: 0 })
    const sent = vi.mocked(sendWhatsAppOtp).mock.calls[0][0]
    expect(sent.to).toBe(row.phone)
    expect(row.code_hash).toBe(hashCode(sent.code))
    expect(sent.code).toMatch(/^[0-9]{6}$/)
  })

  it('web mode treats an unconfigured sender as success (current behaviour, pinned)', async () => {
    vi.mocked(isWhatsAppOtpConfigured).mockReturnValue(false)
    vi.mocked(sendWhatsAppOtp).mockResolvedValue({ ok: false, skipped: true })
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r.ok).toBe(true)
  })

  it('strict mode refuses an unconfigured sender and writes nothing', async () => {
    vi.mocked(isWhatsAppOtpConfigured).mockReturnValue(false)
    const s = fresh()
    const r = await performRequestPhoneCode({ admin: fakeAdmin(s), userId: 'u1', rawPhone: '08012345678', strictDelivery: true, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'unavailable' })
    expect(s.upserts).toHaveLength(0)
    expect(hitLimit).not.toHaveBeenCalled()
    expect(sendWhatsAppOtp).not.toHaveBeenCalled()
  })

  it('reports send_failed when the provider rejects', async () => {
    vi.mocked(sendWhatsAppOtp).mockResolvedValue({ ok: false, error: 'bad' })
    const r = await performRequestPhoneCode({ admin: fakeAdmin(fresh()), userId: 'u1', rawPhone: '08012345678', strictDelivery: false, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'send_failed' })
  })
})

describe('performConfirmPhoneCode', () => {
  const pending = (over: Partial<NonNullable<State['pending']>> = {}) => ({
    phone: '2348012345678',
    code_hash: hashCode('123456'),
    attempts: 0,
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    created_at: NOW.toISOString(),
    ...over,
  })

  it.each(['', '12345', '1234567', 'abcdef'])('rejects the malformed code %j', async (code) => {
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(fresh()), userId: 'u1', code, now: NOW })
    expect(r).toEqual({ ok: false, reason: 'invalid_code' })
  })

  it('needs a pending code', async () => {
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(fresh()), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects an expired code', async () => {
    const s = fresh()
    s.pending = pending({ expires_at: new Date(NOW.getTime() - 1).toISOString() })
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'expired' })
  })

  it('locks out after 5 attempts even with the right code', async () => {
    const s = fresh()
    s.pending = pending({ attempts: 5 })
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'attempts_exceeded' })
    expect(s.profileUpdates).toHaveLength(0)
  })

  it('counts a wrong attempt', async () => {
    const s = fresh()
    s.pending = pending({ attempts: 2 })
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '000000', now: NOW })
    expect(r).toEqual({ ok: false, reason: 'wrong' })
    expect(s.attemptWrites).toEqual([{ attempts: 3 }])
    expect(s.profileUpdates).toHaveLength(0)
  })

  it('writes phone and verification time together, unlocks achievements, clears the pending row', async () => {
    const s = fresh()
    s.pending = pending()
    const r = await performConfirmPhoneCode({ admin: fakeAdmin(s), userId: 'u1', code: '123456', now: NOW })
    expect(r).toEqual({ ok: true, verifiedAt: NOW.toISOString() })
    expect(s.profileUpdates).toEqual([{ phone: '2348012345678', phone_verified_at: NOW.toISOString() }])
    expect(checkAndUnlockAchievements).toHaveBeenCalledWith(expect.anything(), 'u1', { type: 'profile_updated' })
    expect(s.deleted).toBe(1)
  })
})
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run lib/phone/service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

```ts
// lib/phone/service.ts
import { randomInt } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { toWhatsAppNumber } from './number'
import { phoneCodeSchema } from './schema'
import { hashCode, codeMatches } from './hash'
import { sendWhatsAppOtp, isWhatsAppOtpConfigured } from '@/lib/notifications/whatsapp-cloud-api'
import { checkAndUnlockAchievements } from '@/lib/achievements/unlock'
import { hitLimit, otpKey, OTP_DAILY_LIMIT } from '@/lib/rate-limit/account-limiter'

type Admin = SupabaseClient<Database>

export const CODE_TTL_MS = 10 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_ATTEMPTS = 5

export type RequestPhoneCodeOutcome =
  | { ok: true; expiresAt: string; resendAt: string }
  | { ok: false; reason: 'invalid_phone' | 'unavailable' | 'send_failed' | 'save_failed' }
  | { ok: false; reason: 'cooldown' | 'daily_limit'; retryAfterSeconds: number }

// Extracted from lib/phone/actions.ts requestPhoneCode(); the action and POST /me/phone/code
// both call it.
//
// strictDelivery is the one deliberate difference. The web action has always treated an
// unconfigured WhatsApp sender as success (the form says "code sent" and nothing arrives). The
// API must not: with enforce_phone_verification on, that strands every player at a code that
// never comes. Strict mode refuses BEFORE writing a row or spending a rate-limit hit.
export async function performRequestPhoneCode(args: {
  admin: Admin
  userId: string
  rawPhone: string
  strictDelivery: boolean
  now?: Date
}): Promise<RequestPhoneCodeOutcome> {
  const { admin, userId } = args
  const now = args.now ?? new Date()

  if (args.strictDelivery && !isWhatsAppOtpConfigured()) return { ok: false, reason: 'unavailable' }

  // Parse against the player's own country: a South African or Kenyan national number is 10
  // digits starting '0' just like a truncated Nigerian one, and guessing Nigeria would send
  // their code to a stranger's WhatsApp.
  const { data: countryRow } = await admin.from('profiles').select('country').eq('id', userId).maybeSingle()
  const phone = toWhatsAppNumber(args.rawPhone, { country: countryRow?.country })
  if (!phone) return { ok: false, reason: 'invalid_phone' }

  const { data: existing } = await admin.from('phone_verifications').select('created_at').eq('user_id', userId).maybeSingle()
  if (existing) {
    const elapsed = now.getTime() - new Date(existing.created_at).getTime()
    if (elapsed < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfterSeconds: Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)) }
    }
  }

  const limit = await hitLimit(admin, { key: otpKey(userId), ...OTP_DAILY_LIMIT, now })
  if (!limit.allowed) return { ok: false, reason: 'daily_limit', retryAfterSeconds: limit.retryAfterSeconds }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS)
  const { error } = await admin.from('phone_verifications').upsert(
    {
      user_id: userId,
      phone,
      code_hash: hashCode(code),
      attempts: 0,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, reason: 'save_failed' }

  const sent = await sendWhatsAppOtp({ to: phone, code })
  if (!sent.ok && !sent.skipped) return { ok: false, reason: 'send_failed' }

  return { ok: true, expiresAt: expiresAt.toISOString(), resendAt: new Date(now.getTime() + RESEND_COOLDOWN_MS).toISOString() }
}

export type ConfirmPhoneCodeOutcome =
  | { ok: true; verifiedAt: string }
  | { ok: false; reason: 'invalid_code' | 'missing' | 'expired' | 'attempts_exceeded' | 'wrong' }

export async function performConfirmPhoneCode(args: {
  admin: Admin
  userId: string
  code: string
  now?: Date
}): Promise<ConfirmPhoneCodeOutcome> {
  const { admin, userId } = args
  const now = args.now ?? new Date()

  const parsed = phoneCodeSchema.safeParse(args.code)
  if (!parsed.success) return { ok: false, reason: 'invalid_code' }

  const { data: pending } = await admin
    .from('phone_verifications')
    .select('phone, code_hash, attempts, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (!pending) return { ok: false, reason: 'missing' }
  if (new Date(pending.expires_at).getTime() < now.getTime()) return { ok: false, reason: 'expired' }
  if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'attempts_exceeded' }

  if (!codeMatches(parsed.data, pending.code_hash)) {
    await admin.from('phone_verifications').update({ attempts: pending.attempts + 1 }).eq('user_id', userId)
    return { ok: false, reason: 'wrong' }
  }

  // Single update: both columns together, per the design spec.
  const verifiedAt = now.toISOString()
  await admin.from('profiles').update({ phone: pending.phone, phone_verified_at: verifiedAt }).eq('id', userId)
  await checkAndUnlockAchievements(admin, userId, { type: 'profile_updated' })
  await admin.from('phone_verifications').delete().eq('user_id', userId)
  return { ok: true, verifiedAt }
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run lib/phone/service.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `lib/phone/actions.ts`**

Keep `'use server'`, the `PhoneActionState` export, and both exported action names. New bodies:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { performRequestPhoneCode, performConfirmPhoneCode } from './service'

export type PhoneActionState = { error?: string; success?: boolean } | undefined

const REQUEST_ERRORS = {
  invalid_phone: 'Enter a valid phone number, including your country code if you are outside Nigeria.',
  cooldown: 'Please wait a minute before requesting another code.',
  daily_limit: 'Too many codes requested today. Please try again tomorrow.',
  unavailable: 'Could not send a code. Please try again.',
  send_failed: 'Could not send the WhatsApp message. Please try again.',
  save_failed: 'Could not send a code. Please try again.',
} as const

const CONFIRM_ERRORS = {
  invalid_code: 'Enter the 6-digit code',
  missing: 'Request a new code first.',
  expired: 'That code expired. Request a new one.',
  attempts_exceeded: 'Too many incorrect attempts. Request a new code.',
  wrong: 'Incorrect code.',
} as const

export async function requestPhoneCode(_prev: PhoneActionState, formData: FormData): Promise<PhoneActionState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }
  const result = await performRequestPhoneCode({
    admin: createAdminClient(),
    userId: user.id,
    rawPhone: String(formData.get('phone') ?? ''),
    strictDelivery: false, // the web has always reported success when the sender is unconfigured
  })
  return result.ok ? { success: true } : { error: REQUEST_ERRORS[result.reason] }
}

export async function confirmPhoneCode(_prev: PhoneActionState, formData: FormData): Promise<PhoneActionState> {
  const {
    data: { user },
  } = await createClient().auth.getUser()
  if (!user) return { error: 'Please log in.' }
  const result = await performConfirmPhoneCode({ admin: createAdminClient(), userId: user.id, code: String(formData.get('code') ?? '') })
  if (!result.ok) return { error: CONFIRM_ERRORS[result.reason] }
  revalidatePath('/dashboard')
  return { success: true }
}
```

Note: the original returned the zod issue message for a malformed code; `phoneCodeSchema`'s only message is `'Enter the 6-digit code'`, so `CONFIRM_ERRORS.invalid_code` is identical. The original also called `revalidatePath('/dashboard')` only on success: preserved.

- [ ] **Step 7: Run phone tests and typecheck**

Run: `npx vitest run lib/phone lib/notifications/whatsapp-cloud-api.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/phone lib/notifications/whatsapp-cloud-api.ts
git commit -m "refactor(phone): extract OTP service, add daily cap and strict-delivery mode

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Locale service and `/api/locale`

**Files:**
- Create: `lib/profile/locale-service.ts`
- Modify: `app/api/locale/route.ts`
- Test: `lib/profile/locale-service.test.ts`

**Interfaces:**
- Produces: `isSupportedLocale(value: unknown): value is Locale`; `performSetLocale(admin, userId, locale: string): Promise<{ ok: true; locale: Locale } | { ok: false; reason: 'invalid_locale' | 'save_failed' }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/profile/locale-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performSetLocale, isSupportedLocale } from './locale-service'

function admin(error: { message: string } | null = null, onUpdate?: (patch: unknown, id: string) => void) {
  return {
    from: () => ({ update: (patch: unknown) => ({ eq: async (_c: string, id: string) => { onUpdate?.(patch, id); return { error } } }) }),
  } as never
}

describe('isSupportedLocale', () => {
  it.each(['en', 'fr', 'pcm'])('accepts %s', (l) => expect(isSupportedLocale(l)).toBe(true))
  it.each(['EN', 'pt', '', 'en-US', null, undefined, 3])('rejects %j', (l) => expect(isSupportedLocale(l)).toBe(false))
})

describe('performSetLocale', () => {
  it('writes the locale for the caller only', async () => {
    const onUpdate = vi.fn()
    const r = await performSetLocale(admin(null, onUpdate), 'u1', 'pcm')
    expect(r).toEqual({ ok: true, locale: 'pcm' })
    expect(onUpdate).toHaveBeenCalledWith({ locale: 'pcm' }, 'u1')
  })

  it('rejects an unknown locale without writing', async () => {
    const onUpdate = vi.fn()
    const r = await performSetLocale(admin(null, onUpdate), 'u1', 'de')
    expect(r).toEqual({ ok: false, reason: 'invalid_locale' })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('reports a failed write', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await performSetLocale(admin({ message: 'x' }), 'u1', 'fr')
    expect(r).toEqual({ ok: false, reason: 'save_failed' })
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run lib/profile/locale-service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/profile/locale-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { LOCALES, type Locale } from '@/i18n/locales'

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

// Shared by POST /api/locale (web, which also sets the NEXT_LOCALE cookie) and PUT /me/locale.
export async function performSetLocale(
  admin: SupabaseClient<Database>,
  userId: string,
  locale: string,
): Promise<{ ok: true; locale: Locale } | { ok: false; reason: 'invalid_locale' | 'save_failed' }> {
  if (!isSupportedLocale(locale)) return { ok: false, reason: 'invalid_locale' }
  const { error } = await admin.from('profiles').update({ locale }).eq('id', userId)
  if (error) {
    console.error('[locale] update failed', { message: error.message })
    return { ok: false, reason: 'save_failed' }
  }
  return { ok: true, locale }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run lib/profile/locale-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `/api/locale` use the service**

Replace `app/api/locale/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupportedLocale, performSetLocale } from '@/lib/profile/locale-service'

export async function POST(req: Request) {
  const { locale } = (await req.json()) as { locale?: string }
  if (!isSupportedLocale(locale)) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await performSetLocale(createAdminClient(), user.id, locale)
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('NEXT_LOCALE', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}
```

(Behaviour preserved: a failed profile write is still not surfaced to the web, as before.)

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/profile/locale-service.ts lib/profile/locale-service.test.ts app/api/locale/route.ts
git commit -m "refactor(profile): extract locale service shared by web and mobile

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Mobile account endpoints, error details, routes, OpenAPI

**Files:**
- Modify: `lib/mobile-api/errors.ts`, `lib/mobile-api/errors.test.ts`, `lib/mobile-api/endpoints/index.ts`
- Create: `lib/mobile-api/endpoints/account.ts`, `lib/mobile-api/endpoints/account.test.ts`
- Create route files: `app/api/mobile/v1/me/account/route.ts`, `me/deletion/route.ts`, `me/deletion/execute/route.ts`, `me/phone/code/route.ts`, `me/phone/confirm/route.ts`, `me/email/route.ts`, `me/identities/google/route.ts`, `me/locale/route.ts`
- Regenerate: `openapi/mobile-v1.json`

**Interfaces:**
- Consumes: Tasks 1-6 services; `ApiError`; `defineEndpoint`; `daysRemaining`/`deletionDueAt` (`lib/settings/grace.ts`).
- Produces (operation ids the mobile plan depends on, exactly): `getMyAccount` GET `/me/account`; `postAccountDeletion` POST `/me/deletion`; `deleteAccountDeletion` DELETE `/me/deletion`; `postAccountDeletionExecute` POST `/me/deletion/execute`; `postPhoneCode` POST `/me/phone/code`; `postPhoneConfirm` POST `/me/phone/confirm`; `postMyEmail` POST `/me/email`; `deleteGoogleIdentity` DELETE `/me/identities/google`; `putMyLocale` PUT `/me/locale`.

- [ ] **Step 1: Add `details` to `ApiError`** (failing test first)

Append to `lib/mobile-api/errors.test.ts` inside the `describe`:

```ts
  it('carries structured details into the body when given', () => {
    const e = new ApiError(409, 'deletion_blocked', 'blocked', undefined, { blockers: [{ code: 'wallet_balance', amount: 5 }] })
    expect(errorBody(e)).toEqual({
      error: { code: 'deletion_blocked', message: 'blocked', details: { blockers: [{ code: 'wallet_balance', amount: 5 }] } },
    })
  })
```

Run: `npx vitest run lib/mobile-api/errors.test.ts`
Expected: FAIL (TypeScript/expect mismatch).

Then in `lib/mobile-api/errors.ts` change the class and `errorBody`:

```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
```
```ts
export function errorBody(e: ApiError): {
  error: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> }
} {
  return {
    error: {
      code: e.code,
      message: e.message,
      ...(e.fields ? { fields: e.fields } : {}),
      ...(e.details ? { details: e.details } : {}),
    },
  }
}
```

Run: `npx vitest run lib/mobile-api/errors.test.ts`
Expected: PASS. Then add `details` to the `ApiError` schema in `lib/mobile-api/openapi.ts` (`components.schemas.ApiError.properties.error.properties`) as `details: { type: 'object', additionalProperties: true, description: 'Structured, code-specific data (for example deletion blockers).' }`; look at the existing `fields` property in that file and mirror it. `npm run openapi` (Step 9) will snapshot the change.

- [ ] **Step 2: Write the failing endpoint tests**

```ts
// lib/mobile-api/endpoints/account.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/settings/deletion-flow', () => ({ performRequestDeletion: vi.fn(), performCancelDeletion: vi.fn(), performDeleteNow: vi.fn() }))
vi.mock('@/lib/phone/service', () => ({ performRequestPhoneCode: vi.fn(), performConfirmPhoneCode: vi.fn() }))
vi.mock('@/lib/auth/email-change-service', () => ({ performChangeEmail: vi.fn() }))
vi.mock('@/lib/auth/unlink-google-service', () => ({ performUnlinkGoogle: vi.fn() }))
vi.mock('@/lib/profile/locale-service', async (orig) => ({ ...(await orig<object>()), performSetLocale: vi.fn() }))
vi.mock('@/lib/rate-limit/account-limiter', async (orig) => ({ ...(await orig<object>()), hitLimit: vi.fn() }))
vi.mock('@/lib/auth/reauth', () => ({ verifyPassword: vi.fn(), hasPasswordIdentity: vi.fn(() => true) }))
vi.mock('@/lib/auth/signup-blocks', () => ({ isIdentifierBanned: vi.fn(async () => false) }))

import { performRequestDeletion, performCancelDeletion, performDeleteNow } from '@/lib/settings/deletion-flow'
import { performRequestPhoneCode, performConfirmPhoneCode } from '@/lib/phone/service'
import { performChangeEmail } from '@/lib/auth/email-change-service'
import { performUnlinkGoogle } from '@/lib/auth/unlink-google-service'
import { performSetLocale } from '@/lib/profile/locale-service'
import { hitLimit } from '@/lib/rate-limit/account-limiter'
import { maskPhone, toAccountResponse, runWithCtx, handlers } from './account'

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    userId: 'u1',
    email: 'a@example.com',
    accessToken: 'tok',
    admin: {
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'a@example.com', new_email: null, identities: [{ identity_id: 'i1', provider: 'email' }] } }, error: null })) } },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { deletion_requested_at: null, deleted_at: null, phone: null, phone_verified_at: null, locale: 'en' } }) }) }) }),
    },
    ...over,
  }) as never

beforeEach(() => {
  vi.mocked(hitLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
})

describe('maskPhone', () => {
  it('keeps only the last three digits', () => expect(maskPhone('2348012345678')).toBe('••••••••••678'))
  it('never leaks a short number', () => expect(maskPhone('12')).toBe('••'))
})

describe('toAccountResponse', () => {
  const profile = { deletion_requested_at: null, deleted_at: null, phone: null, phone_verified_at: null, locale: 'fr' }
  const user = { email: 'a@example.com', new_email: null, identities: [{ provider: 'google' }, { provider: 'email' }] }

  it('reports no deletion, no phone and the sign-in methods', () => {
    const r = toAccountResponse(profile, user as never, new Date('2026-10-07T00:00:00Z'))
    expect(r).toEqual({
      deletion: null,
      signIn: { email: 'a@example.com', pendingEmail: null, passwordIdentity: true, google: true },
      phone: null,
      locale: 'fr',
    })
  })

  it('computes the deletion window from the request time', () => {
    const r = toAccountResponse({ ...profile, deletion_requested_at: '2026-10-05T00:00:00.000Z' }, user as never, new Date('2026-10-07T00:00:00Z'))
    expect(r.deletion).toEqual({ requestedAt: '2026-10-05T00:00:00.000Z', dueAt: '2026-10-20T00:00:00.000Z', daysRemaining: 13 })
  })

  it('treats a tombstoned profile as not pending deletion', () => {
    const r = toAccountResponse({ ...profile, deletion_requested_at: '2026-10-05T00:00:00.000Z', deleted_at: '2026-10-06T00:00:00.000Z' }, user as never, new Date('2026-10-07T00:00:00Z'))
    expect(r.deletion).toBeNull()
  })

  it('masks a verified phone and never returns the number', () => {
    const r = toAccountResponse({ ...profile, phone: '2348012345678', phone_verified_at: '2026-10-01T00:00:00.000Z' }, user as never, new Date())
    expect(r.phone).toEqual({ masked: '••••••••••678', verifiedAt: '2026-10-01T00:00:00.000Z' })
    expect(JSON.stringify(r)).not.toContain('2348012345678')
  })

  it('reports the pending new email', () => {
    const r = toAccountResponse(profile, { ...user, new_email: 'next@example.com' } as never, new Date())
    expect(r.signIn.pendingEmail).toBe('next@example.com')
  })
})

describe('deletion endpoints', () => {
  it('POST /me/deletion requires the literal DELETE', async () => {
    const res = await handlers.requestDeletion(ctx(), { confirm: 'delete' as never })
    expect(res).toMatchObject({ status: 400, code: 'confirm_required' })
  })

  it('POST /me/deletion maps blockers to a 409 with details', async () => {
    vi.mocked(performRequestDeletion).mockResolvedValue({ ok: false, reason: 'blocked', blockers: [{ code: 'wallet_balance', amount: 5 }] })
    const res = await handlers.requestDeletion(ctx(), { confirm: 'DELETE' })
    expect(res).toMatchObject({ status: 409, code: 'deletion_blocked', details: { blockers: [{ code: 'wallet_balance', amount: 5 }] } })
  })

  it('POST /me/deletion returns ISO times on success', async () => {
    const requestedAt = new Date('2026-10-07T00:00:00.000Z')
    vi.mocked(performRequestDeletion).mockResolvedValue({ ok: true, requestedAt, dueAt: new Date('2026-10-22T00:00:00.000Z') })
    const res = await handlers.requestDeletion(ctx(), { confirm: 'DELETE' })
    expect(res).toEqual({ requestedAt: '2026-10-07T00:00:00.000Z', dueAt: '2026-10-22T00:00:00.000Z' })
  })

  it('DELETE /me/deletion cancels', async () => {
    vi.mocked(performCancelDeletion).mockResolvedValue({ ok: true })
    expect(await handlers.cancelDeletion(ctx())).toEqual({ ok: true })
  })

  it('execute maps a username mismatch to 400', async () => {
    vi.mocked(performDeleteNow).mockResolvedValue({ ok: false, reason: 'username_mismatch' })
    const res = await handlers.deleteNow(ctx(), { username: 'x' })
    expect(res).toMatchObject({ status: 400, code: 'username_mismatch' })
  })
})

describe('phone endpoints', () => {
  it('requests a code in strict mode', async () => {
    vi.mocked(performRequestPhoneCode).mockResolvedValue({ ok: true, expiresAt: 'e', resendAt: 'r' })
    const res = await handlers.requestPhoneCode(ctx(), { phone: '08012345678' })
    expect(res).toEqual({ expiresAt: 'e', resendAt: 'r' })
    expect(vi.mocked(performRequestPhoneCode).mock.calls[0][0]).toMatchObject({ userId: 'u1', strictDelivery: true })
  })

  it.each([
    ['unavailable', 503, 'phone_unavailable'],
    ['invalid_phone', 400, 'phone_invalid'],
    ['send_failed', 502, 'phone_send_failed'],
    ['save_failed', 500, 'phone_save_failed'],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    vi.mocked(performRequestPhoneCode).mockResolvedValue({ ok: false, reason })
    expect(await handlers.requestPhoneCode(ctx(), { phone: '08012345678' })).toMatchObject({ status, code })
  })

  it.each([
    ['cooldown', 'phone_cooldown'],
    ['daily_limit', 'phone_daily_limit'],
  ] as const)('maps %s to a 429 with retryAfterSeconds', async (reason, code) => {
    vi.mocked(performRequestPhoneCode).mockResolvedValue({ ok: false, reason, retryAfterSeconds: 40 })
    expect(await handlers.requestPhoneCode(ctx(), { phone: '08012345678' })).toMatchObject({ status: 429, code, fields: { retryAfterSeconds: '40' } })
  })

  it.each([
    ['invalid_code', 400, 'phone_code_invalid'],
    ['missing', 409, 'phone_code_missing'],
    ['expired', 409, 'phone_code_expired'],
    ['attempts_exceeded', 429, 'phone_attempts_exceeded'],
    ['wrong', 400, 'phone_code_wrong'],
  ] as const)('confirm maps %s to %i %s', async (reason, status, code) => {
    vi.mocked(performConfirmPhoneCode).mockResolvedValue({ ok: false, reason })
    expect(await handlers.confirmPhoneCode(ctx(), { code: '123456' })).toMatchObject({ status, code })
  })

  it('confirm returns the verification time', async () => {
    vi.mocked(performConfirmPhoneCode).mockResolvedValue({ ok: true, verifiedAt: 'v' })
    expect(await handlers.confirmPhoneCode(ctx(), { code: '123456' })).toEqual({ verifiedAt: 'v' })
  })
})

describe('password-taking endpoints', () => {
  it('POST /me/email answers 429 when the re-auth limit is hit, before checking the password', async () => {
    vi.mocked(hitLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 300 })
    const res = await handlers.changeEmail(ctx(), { email: 'n@example.com', password: 'pw' })
    expect(res).toMatchObject({ status: 429, code: 'reauth_rate_limited', fields: { retryAfterSeconds: '300' } })
    expect(performChangeEmail).not.toHaveBeenCalled()
  })

  it('POST /me/email returns sentTo', async () => {
    vi.mocked(performChangeEmail).mockResolvedValue({ ok: true, sentTo: 'n@example.com' })
    expect(await handlers.changeEmail(ctx(), { email: 'N@example.com', password: 'pw' })).toEqual({ sentTo: 'n@example.com' })
  })

  it.each([
    ['wrong_password', 400],
    ['google_only', 400],
    ['same_email', 400],
    ['email_banned', 400],
    ['email_in_use', 409],
    ['failed', 502],
  ] as const)('POST /me/email maps %s to %i with the same code', async (errorCode, status) => {
    vi.mocked(performChangeEmail).mockResolvedValue({ ok: false, errorCode })
    expect(await handlers.changeEmail(ctx(), { email: 'n@example.com', password: 'pw' })).toMatchObject({ status, code: errorCode })
  })

  it('DELETE /me/identities/google is limited like email change', async () => {
    vi.mocked(hitLimit).mockResolvedValue({ allowed: false, retryAfterSeconds: 60 })
    const res = await handlers.unlinkGoogle(ctx(), { password: 'pw' })
    expect(res).toMatchObject({ status: 429, code: 'reauth_rate_limited' })
    expect(performUnlinkGoogle).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong_password', 400, 'wrong_password'],
    ['not_linked', 409, 'not_linked'],
    ['last_identity', 409, 'last_identity'],
    ['unavailable', 503, 'linking_unavailable'],
    ['failed', 502, 'failed'],
  ] as const)('unlink maps %s to %i %s', async (errorCode, status, code) => {
    vi.mocked(performUnlinkGoogle).mockResolvedValue({ ok: false, errorCode })
    expect(await handlers.unlinkGoogle(ctx(), { password: 'pw' })).toMatchObject({ status, code })
  })
})

describe('PUT /me/locale', () => {
  it('returns the saved locale', async () => {
    vi.mocked(performSetLocale).mockResolvedValue({ ok: true, locale: 'pcm' })
    expect(await handlers.setLocale(ctx(), { locale: 'pcm' })).toEqual({ locale: 'pcm' })
  })
  it('maps a save failure to 500', async () => {
    vi.mocked(performSetLocale).mockResolvedValue({ ok: false, reason: 'save_failed' })
    expect(await handlers.setLocale(ctx(), { locale: 'fr' })).toMatchObject({ status: 500, code: 'locale_save_failed' })
  })
})

describe('runWithCtx', () => {
  it('turns a returned error descriptor into an ApiError', async () => {
    await expect(runWithCtx(async () => ({ status: 409, code: 'x', message: 'y' }))).rejects.toMatchObject({ status: 409, code: 'x' })
  })
  it('passes a normal value through', async () => {
    expect(await runWithCtx(async () => ({ ok: true }))).toEqual({ ok: true })
  })
})
```

Design note encoded in these tests: handler *logic* lives in a `handlers` object whose functions **return** either the success value or an error descriptor `{ status, code, message, fields?, details? }`; the `defineEndpoint` handlers wrap them with `runWithCtx`, which throws an `ApiError` for descriptors. This keeps the tests free of throw/catch plumbing while the endpoints still use the standard `ApiError` path.

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run lib/mobile-api/endpoints/account.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `lib/mobile-api/endpoints/account.ts`**

```ts
import { z } from 'zod'
import type { User } from '@supabase/supabase-js'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'
import { ApiError } from '../errors'
import { bearerPort } from '@/lib/auth/account-auth-port'
import { performChangeEmail } from '@/lib/auth/email-change-service'
import { performUnlinkGoogle } from '@/lib/auth/unlink-google-service'
import { verifyPassword, hasPasswordIdentity } from '@/lib/auth/reauth'
import { isIdentifierBanned } from '@/lib/auth/signup-blocks'
import { changeEmailSchema } from '@/lib/auth/schema'
import { performRequestDeletion, performCancelDeletion, performDeleteNow } from '@/lib/settings/deletion-flow'
import { daysRemaining, deletionDueAt, isPendingDeletion } from '@/lib/settings/grace'
import { performRequestPhoneCode, performConfirmPhoneCode } from '@/lib/phone/service'
import { performSetLocale } from '@/lib/profile/locale-service'
import { hitLimit, reauthKey, REAUTH_LIMIT } from '@/lib/rate-limit/account-limiter'
import { LOCALES } from '@/i18n/locales'

// ---- error descriptors -------------------------------------------------------------------

interface ErrorDescriptor {
  status: number
  code: string
  message: string
  fields?: Record<string, string>
  details?: Record<string, unknown>
}
const isDescriptor = (v: unknown): v is ErrorDescriptor =>
  typeof v === 'object' && v !== null && 'status' in v && 'code' in v && 'message' in v

const err = (status: number, code: string, message: string, extra: Pick<ErrorDescriptor, 'fields' | 'details'> = {}): ErrorDescriptor => ({
  status,
  code,
  message,
  ...extra,
})
const retry = (seconds: number) => ({ fields: { retryAfterSeconds: String(seconds) } })

// Handlers return a value or an ErrorDescriptor; the endpoint wrapper throws the latter as an
// ApiError so the standard envelope and status handling in defineEndpoint apply.
export async function runWithCtx<T>(fn: () => Promise<T | ErrorDescriptor>): Promise<T> {
  const result = await fn()
  if (isDescriptor(result)) throw new ApiError(result.status, result.code, result.message, result.fields, result.details)
  return result as T
}

// ---- GET /me/account ---------------------------------------------------------------------

// Last three digits only. A short number is masked entirely so the mask never reveals it.
export function maskPhone(phone: string): string {
  if (phone.length <= 3) return '•'.repeat(phone.length)
  return '•'.repeat(phone.length - 3) + phone.slice(-3)
}

const accountResponse = z.object({
  deletion: z.object({ requestedAt: z.string(), dueAt: z.string(), daysRemaining: z.number().int() }).nullable(),
  signIn: z.object({
    email: z.string().nullable(),
    pendingEmail: z.string().nullable(),
    // A hint, not truth: a Google user who set a password through the reset flow has no
    // 'email' identity (hasPasswordIdentity). The app words `false` as "set or reset a password".
    passwordIdentity: z.boolean(),
    google: z.boolean(),
  }),
  phone: z.object({ masked: z.string(), verifiedAt: z.string() }).nullable(),
  locale: z.string().nullable(),
})

interface AccountProfileRow {
  deletion_requested_at: string | null
  deleted_at: string | null
  phone: string | null
  phone_verified_at: string | null
  locale: string | null
}

export function toAccountResponse(
  profile: AccountProfileRow,
  user: Pick<User, 'email' | 'new_email' | 'identities'>,
  now: Date,
): z.infer<typeof accountResponse> {
  const pending = isPendingDeletion(profile)
  const requested = pending && profile.deletion_requested_at ? new Date(profile.deletion_requested_at) : null
  return {
    deletion: requested
      ? { requestedAt: requested.toISOString(), dueAt: deletionDueAt(requested).toISOString(), daysRemaining: daysRemaining(requested, now) }
      : null,
    signIn: {
      email: user.email ?? null,
      pendingEmail: user.new_email ?? null,
      passwordIdentity: hasPasswordIdentity({ identities: user.identities }),
      google: (user.identities ?? []).some((i) => i.provider === 'google'),
    },
    phone: profile.phone && profile.phone_verified_at ? { masked: maskPhone(profile.phone), verifiedAt: profile.phone_verified_at } : null,
    locale: profile.locale,
  }
}

// ---- handler logic (returns value | ErrorDescriptor) -------------------------------------

type Admin = MobileCtx['admin']
const okTrue = { ok: true as const }

async function reauthGate(admin: Admin, userId: string): Promise<ErrorDescriptor | null> {
  const gate = await hitLimit(admin, { key: reauthKey(userId), ...REAUTH_LIMIT })
  return gate.allowed ? null : err(429, 'reauth_rate_limited', 'Too many attempts. Try again later.', retry(gate.retryAfterSeconds))
}

export const handlers = {
  async getAccount(ctx: MobileCtx) {
    const [{ data: profile }, { data: auth }] = await Promise.all([
      ctx.admin
        .from('profiles')
        .select('deletion_requested_at, deleted_at, phone, phone_verified_at, locale')
        .eq('id', ctx.userId)
        .maybeSingle(),
      ctx.admin.auth.admin.getUserById(ctx.userId),
    ])
    if (!profile || !auth?.user) return err(404, 'not_found', 'Not found.')
    return toAccountResponse(profile, auth.user, new Date())
  },

  async requestDeletion(ctx: MobileCtx, body: { confirm: 'DELETE' }) {
    if (body.confirm !== 'DELETE') return err(400, 'confirm_required', 'Type DELETE to confirm.')
    const result = await performRequestDeletion(ctx.admin, { id: ctx.userId, email: ctx.email })
    if (!result.ok) {
      return result.reason === 'blocked'
        ? err(409, 'deletion_blocked', 'This account cannot be deleted yet.', { details: { blockers: result.blockers } })
        : err(500, 'deletion_save_failed', 'Could not schedule deletion.')
    }
    return { requestedAt: result.requestedAt.toISOString(), dueAt: result.dueAt.toISOString() }
  },

  async cancelDeletion(ctx: MobileCtx) {
    const result = await performCancelDeletion(ctx.admin, { id: ctx.userId, email: ctx.email })
    return result.ok ? okTrue : err(500, 'deletion_cancel_failed', 'Could not cancel the deletion.')
  },

  async deleteNow(ctx: MobileCtx, body: { username: string }) {
    const result = await performDeleteNow(ctx.admin, ctx.userId, body.username)
    if (result.ok) return okTrue
    return result.reason === 'blocked'
      ? err(409, 'deletion_blocked', 'This account cannot be deleted yet.', { details: { blockers: result.blockers } })
      : err(400, 'username_mismatch', 'That does not match your username.')
  },

  async requestPhoneCode(ctx: MobileCtx, body: { phone: string }) {
    const result = await performRequestPhoneCode({ admin: ctx.admin, userId: ctx.userId, rawPhone: body.phone, strictDelivery: true })
    if (result.ok) return { expiresAt: result.expiresAt, resendAt: result.resendAt }
    switch (result.reason) {
      case 'unavailable':
        return err(503, 'phone_unavailable', 'Phone verification is unavailable right now.')
      case 'invalid_phone':
        return err(400, 'phone_invalid', 'Enter a valid phone number.')
      case 'send_failed':
        return err(502, 'phone_send_failed', 'Could not send the code.')
      case 'save_failed':
        return err(500, 'phone_save_failed', 'Could not send the code.')
      case 'cooldown':
        return err(429, 'phone_cooldown', 'Wait before requesting another code.', retry(result.retryAfterSeconds))
      case 'daily_limit':
        return err(429, 'phone_daily_limit', 'Too many codes requested today.', retry(result.retryAfterSeconds))
    }
  },

  async confirmPhoneCode(ctx: MobileCtx, body: { code: string }) {
    const result = await performConfirmPhoneCode({ admin: ctx.admin, userId: ctx.userId, code: body.code })
    if (result.ok) return { verifiedAt: result.verifiedAt }
    switch (result.reason) {
      case 'invalid_code':
        return err(400, 'phone_code_invalid', 'Enter the 6-digit code.')
      case 'missing':
        return err(409, 'phone_code_missing', 'Request a new code first.')
      case 'expired':
        return err(409, 'phone_code_expired', 'That code expired.')
      case 'attempts_exceeded':
        return err(429, 'phone_attempts_exceeded', 'Too many incorrect attempts.')
      case 'wrong':
        return err(400, 'phone_code_wrong', 'Incorrect code.')
    }
  },

  async changeEmail(ctx: MobileCtx, body: { email: string; password: string }) {
    const gated = await reauthGate(ctx.admin, ctx.userId)
    if (gated) return gated
    const { data: auth } = await ctx.admin.auth.admin.getUserById(ctx.userId)
    const result = await performChangeEmail({
      port: bearerPort({ accessToken: ctx.accessToken, userId: ctx.userId, admin: ctx.admin }),
      user: { email: auth?.user?.email ?? ctx.email, identities: auth?.user?.identities },
      input: body,
      deps: { verifyPassword, isBanned: (value) => isIdentifierBanned(ctx.admin, value) },
    })
    if (result.ok) return { sentTo: result.sentTo }
    const status = result.errorCode === 'email_in_use' ? 409 : result.errorCode === 'failed' ? 502 : 400
    return err(status, result.errorCode, 'Could not change the email.')
  },

  async unlinkGoogle(ctx: MobileCtx, body: { password: string }) {
    const gated = await reauthGate(ctx.admin, ctx.userId)
    if (gated) return gated
    const result = await performUnlinkGoogle({
      port: bearerPort({ accessToken: ctx.accessToken, userId: ctx.userId, admin: ctx.admin }),
      user: { email: ctx.email },
      password: body.password,
      verifyPassword,
    })
    if (result.ok) return okTrue
    switch (result.errorCode) {
      case 'not_linked':
      case 'last_identity':
        return err(409, result.errorCode, 'Google cannot be unlinked.')
      case 'unavailable':
        return err(503, 'linking_unavailable', 'Unlinking is unavailable right now.')
      case 'failed':
        return err(502, 'failed', 'Could not unlink Google.')
      default:
        return err(400, result.errorCode, 'Could not unlink Google.')
    }
  },

  async setLocale(ctx: MobileCtx, body: { locale: (typeof LOCALES)[number] }) {
    const result = await performSetLocale(ctx.admin, ctx.userId, body.locale)
    return result.ok ? { locale: result.locale } : err(500, 'locale_save_failed', 'Could not save your language.')
  },
}

// ---- endpoints ---------------------------------------------------------------------------

const ok = z.object({ ok: z.literal(true) })

export const getMyAccountEndpoint = defineEndpoint({
  operationId: 'getMyAccount',
  method: 'GET',
  path: '/me/account',
  summary: 'Deletion state, sign-in methods, masked phone and locale for the Settings hub.',
  auth: 'user',
  response: accountResponse,
  handler: ({ ctx }) => runWithCtx(() => handlers.getAccount(ctx)),
})

export const requestAccountDeletionEndpoint = defineEndpoint({
  operationId: 'postAccountDeletion',
  method: 'POST',
  path: '/me/deletion',
  summary: 'Start the 15-day account-deletion grace period. 409 deletion_blocked lists every blocker in error.details.blockers.',
  auth: 'user',
  body: z.object({ confirm: z.literal('DELETE') }),
  response: z.object({ requestedAt: z.string(), dueAt: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.requestDeletion(ctx, body)),
})

export const cancelAccountDeletionEndpoint = defineEndpoint({
  operationId: 'deleteAccountDeletion',
  method: 'DELETE',
  path: '/me/deletion',
  summary: 'Cancel a pending account deletion.',
  auth: 'user',
  response: ok,
  handler: ({ ctx }) => runWithCtx(() => handlers.cancelDeletion(ctx)),
})

export const deleteAccountNowEndpoint = defineEndpoint({
  operationId: 'postAccountDeletionExecute',
  method: 'POST',
  path: '/me/deletion/execute',
  summary: 'Delete the account immediately; the body must carry the exact username. Irreversible.',
  auth: 'user',
  body: z.object({ username: z.string().min(1).max(64) }),
  response: ok,
  handler: ({ ctx, body }) => runWithCtx(() => handlers.deleteNow(ctx, body)),
})

export const requestPhoneCodeEndpoint = defineEndpoint({
  operationId: 'postPhoneCode',
  method: 'POST',
  path: '/me/phone/code',
  summary: 'Send a 6-digit WhatsApp verification code. 503 phone_unavailable when WhatsApp is not configured.',
  auth: 'user',
  body: z.object({ phone: z.string().trim().min(5).max(32) }),
  response: z.object({ expiresAt: z.string(), resendAt: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.requestPhoneCode(ctx, body)),
})

export const confirmPhoneCodeEndpoint = defineEndpoint({
  operationId: 'postPhoneConfirm',
  method: 'POST',
  path: '/me/phone/confirm',
  summary: 'Confirm the WhatsApp code and mark the phone verified.',
  auth: 'user',
  body: z.object({ code: z.string().trim().min(1).max(12) }),
  response: z.object({ verifiedAt: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.confirmPhoneCode(ctx, body)),
})

export const changeMyEmailEndpoint = defineEndpoint({
  operationId: 'postMyEmail',
  method: 'POST',
  path: '/me/email',
  summary: 'Start an email change. Needs the current password; nothing changes until the link in the new inbox is opened.',
  auth: 'user',
  body: changeEmailSchema,
  response: z.object({ sentTo: z.string() }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.changeEmail(ctx, body)),
})

export const unlinkGoogleEndpoint = defineEndpoint({
  operationId: 'deleteGoogleIdentity',
  method: 'DELETE',
  path: '/me/identities/google',
  summary: 'Unlink Google sign-in. Needs the current password; signs out every other session.',
  auth: 'user',
  body: z.object({ password: z.string().min(1).max(256) }),
  response: ok,
  handler: ({ ctx, body }) => runWithCtx(() => handlers.unlinkGoogle(ctx, body)),
})

export const setMyLocaleEndpoint = defineEndpoint({
  operationId: 'putMyLocale',
  method: 'PUT',
  path: '/me/locale',
  summary: "Save the signed-in player's language (en, fr or pcm).",
  auth: 'user',
  body: z.object({ locale: z.enum(LOCALES) }),
  response: z.object({ locale: z.enum(LOCALES) }),
  handler: ({ ctx, body }) => runWithCtx(() => handlers.setLocale(ctx, body)),
})
```

Note on `DELETE` with a body (`unlinkGoogle`): this is established precedent. `DELETE /devices` and the notification unmute endpoint already declare a `body`, and `parseBody` (`lib/mobile-api/prelude.ts`) reads JSON regardless of method. The mobile plan's Dio call must send `data:` on `DELETE`.

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run lib/mobile-api/endpoints/account.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the endpoints**

In `lib/mobile-api/endpoints/index.ts` add the import and append all nine to `ALL_ENDPOINTS`:

```ts
import {
  getMyAccountEndpoint,
  requestAccountDeletionEndpoint,
  cancelAccountDeletionEndpoint,
  deleteAccountNowEndpoint,
  requestPhoneCodeEndpoint,
  confirmPhoneCodeEndpoint,
  changeMyEmailEndpoint,
  unlinkGoogleEndpoint,
  setMyLocaleEndpoint,
} from './account'
```
```ts
  getMyAccountEndpoint,
  requestAccountDeletionEndpoint,
  cancelAccountDeletionEndpoint,
  deleteAccountNowEndpoint,
  requestPhoneCodeEndpoint,
  confirmPhoneCodeEndpoint,
  changeMyEmailEndpoint,
  unlinkGoogleEndpoint,
  setMyLocaleEndpoint,
```

- [ ] **Step 7: Add the route files**

```ts
// app/api/mobile/v1/me/account/route.ts
import { getMyAccountEndpoint } from '@/lib/mobile-api/endpoints/account'
export const GET = getMyAccountEndpoint.handler
```
```ts
// app/api/mobile/v1/me/deletion/route.ts
import { requestAccountDeletionEndpoint, cancelAccountDeletionEndpoint } from '@/lib/mobile-api/endpoints/account'
export const POST = requestAccountDeletionEndpoint.handler
export const DELETE = cancelAccountDeletionEndpoint.handler
```
```ts
// app/api/mobile/v1/me/deletion/execute/route.ts
import { deleteAccountNowEndpoint } from '@/lib/mobile-api/endpoints/account'
export const POST = deleteAccountNowEndpoint.handler
```
```ts
// app/api/mobile/v1/me/phone/code/route.ts
import { requestPhoneCodeEndpoint } from '@/lib/mobile-api/endpoints/account'
export const POST = requestPhoneCodeEndpoint.handler
```
```ts
// app/api/mobile/v1/me/phone/confirm/route.ts
import { confirmPhoneCodeEndpoint } from '@/lib/mobile-api/endpoints/account'
export const POST = confirmPhoneCodeEndpoint.handler
```
```ts
// app/api/mobile/v1/me/email/route.ts
import { changeMyEmailEndpoint } from '@/lib/mobile-api/endpoints/account'
export const POST = changeMyEmailEndpoint.handler
```
```ts
// app/api/mobile/v1/me/identities/google/route.ts
import { unlinkGoogleEndpoint } from '@/lib/mobile-api/endpoints/account'
export const DELETE = unlinkGoogleEndpoint.handler
```
```ts
// app/api/mobile/v1/me/locale/route.ts
import { setMyLocaleEndpoint } from '@/lib/mobile-api/endpoints/account'
export const PUT = setMyLocaleEndpoint.handler
```

- [ ] **Step 8: Run the route-file and OpenAPI tests**

Run: `npx vitest run lib/mobile-api/route-files.test.ts lib/mobile-api/openapi.test.ts`
Expected: route-files PASS; `openapi.test.ts` FAILS on the stale snapshot.

- [ ] **Step 9: Regenerate the OpenAPI snapshot**

Run: `npm run openapi`
Then: `git diff --stat openapi/mobile-v1.json` shows only additions (nine operations plus the `details` property), and `npx vitest run lib/mobile-api` passes.

- [ ] **Step 10: Full verification and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

```bash
git add lib/mobile-api app/api/mobile/v1/me openapi/mobile-v1.json
git commit -m "feat(mobile-api): account, deletion, phone, email, Google unlink and locale endpoints

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7b: `/me` exposes `phoneVerifiedAt`

The mobile onboarding gate (`resolveOnboardingGate`) cannot decide the phone step without it: today it returns `OnboardingGate.phone` for **every** signed-in user once `enforcePhoneVerification` is true, and nothing in `/me` says who is already verified. The field is additive and nullable, so shipped app versions ignore it.

**Files:**
- Modify: `lib/mobile-api/endpoints/me.ts` (zod `meResponse`, `ProfileRow`, `toMeResponse`, the `select` in `meEndpoint`)
- Modify: `lib/mobile-api/endpoints/me.test.ts`, `lib/mobile-api/endpoints/me-bubble.test.ts`
- Regenerate: `openapi/mobile-v1.json`

**Interfaces:**
- Produces: `profile.phoneVerifiedAt: string | null` on `GET /me` (ISO timestamp of `profiles.phone_verified_at`).

- [ ] **Step 1: Write the failing tests** (append inside the `describe('toMeResponse', ...)` block of `me.test.ts`, and update the full-object expectation in the first test to include `phoneVerifiedAt: null` after `consentWhatsappUpdates: true`):

```ts
  it('reports phoneVerifiedAt as stored, and null when the phone was never verified', () => {
    expect(toMeResponse(ctx, row, []).profile?.phoneVerifiedAt).toBeNull()
    expect(toMeResponse(ctx, { ...row, phone_verified_at: '2026-10-01T00:00:00.000Z' }, []).profile?.phoneVerifiedAt).toBe('2026-10-01T00:00:00.000Z')
  })
```

In `me-bubble.test.ts`, add `'phoneVerifiedAt'` to the key list on line 30 so the "keeps existing keys" assertion covers it.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run lib/mobile-api/endpoints/me.test.ts lib/mobile-api/endpoints/me-bubble.test.ts`
Expected: FAIL (key missing from the response).

- [ ] **Step 3: Implement** in `lib/mobile-api/endpoints/me.ts`:

In the zod profile object add, after `profileCompletedAt`:

```ts
      // Server-owned: when the WhatsApp number was verified. The app's onboarding gate needs it once
      // enforce_phone_verification is on; null means never verified.
      phoneVerifiedAt: z.string().nullable(),
```

In `ProfileRow` add `phone_verified_at?: string | null` (optional, like `equipped_bubble_skin`, so other callers' fixtures keep compiling). In `toMeResponse`'s `profile` object add `phoneVerifiedAt: row.phone_verified_at ?? null,` after `profileCompletedAt`. In `meEndpoint`'s `.select(...)` string add `phone_verified_at` after `profile_completed_at`.

- [ ] **Step 4: Run and confirm pass, then regenerate the contract**

Run: `npx vitest run lib/mobile-api/endpoints/me.test.ts lib/mobile-api/endpoints/me-bubble.test.ts && npm run openapi && npx vitest run lib/mobile-api`
Expected: PASS; `git diff openapi/mobile-v1.json` shows only the new `phoneVerifiedAt` property.

- [ ] **Step 5: Commit**

```bash
git add lib/mobile-api/endpoints/me.ts lib/mobile-api/endpoints/me.test.ts lib/mobile-api/endpoints/me-bubble.test.ts openapi/mobile-v1.json
git commit -m "feat(mobile-api): expose phoneVerifiedAt on GET /me for the onboarding gate

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Copy for the new screens (en, fr, pcm)

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` (new top-level namespace `mobileSettings`)
- Test: existing `lib/i18n/message-parity.test.ts` (must still pass)

**Interfaces:**
- Produces: namespace `mobileSettings` with exactly the keys below. The mobile plan generates ARB keys `mobileSettings*` from it with `tool/gen_l10n_from_web.dart`. Existing namespaces `accountDeletion`, `emailChange`, `signInMethods` and `auth.phoneStep` are reused as they are and are **not** duplicated.

- [ ] **Step 1: Add the namespace to `messages/en.json`** (append after the last top-level key, before the closing brace; keep valid JSON):

```json
  "mobileSettings": {
    "hubTitle": "Settings",
    "hubProfile": "Profile",
    "hubNotifications": "Notifications",
    "hubLanguage": "Language",
    "hubSecurity": "Security",
    "hubSignInMethods": "Sign-in methods",
    "hubPhone": "Phone verification",
    "hubDeleteAccount": "Delete account",
    "languageTitle": "Language",
    "languageEnglish": "English",
    "languageFrench": "Français",
    "languagePidgin": "Pidgin",
    "languageSaveFailed": "Could not save your language. Please try again.",
    "securityTitle": "Security",
    "securityEmailRow": "Email",
    "securityChangeEmail": "Change email",
    "securityPasswordRow": "Password",
    "securitySetPassword": "Set or reset password",
    "securitySetPasswordHint": "We'll email a link to your current address. Opening it proves the account is yours.",
    "securityResetSent": "Check your inbox for a link to set a new password.",
    "phoneTitle": "Phone verification",
    "phoneNumberLabel": "WhatsApp number",
    "phoneSendCode": "Send code",
    "phoneCodeLabel": "6-digit code",
    "phoneConfirm": "Verify",
    "phoneResend": "Resend code",
    "phoneResendIn": "Resend in {seconds}s",
    "phoneVerified": "Verified: {masked}",
    "phoneUnavailable": "Verification is unavailable right now. Please try again later.",
    "phoneErrorInvalid": "Enter a valid phone number, including your country code if you are outside Nigeria.",
    "phoneErrorCooldown": "Please wait a moment before requesting another code.",
    "phoneErrorDailyLimit": "Too many codes requested today. Please try again tomorrow.",
    "phoneErrorSendFailed": "Could not send the WhatsApp message. Please try again.",
    "phoneErrorCodeInvalid": "Enter the 6-digit code.",
    "phoneErrorCodeMissing": "Request a new code first.",
    "phoneErrorCodeExpired": "That code expired. Request a new one.",
    "phoneErrorCodeWrong": "That code isn't right.",
    "phoneErrorAttempts": "Too many incorrect attempts. Request a new code.",
    "deleteAccountTitle": "Delete account",
    "deleteFailed": "Could not complete that. Please try again.",
    "reauthRateLimited": "Too many attempts. Please try again later.",
    "linkingUnavailable": "This isn't available right now. Please contact support.",
    "genericError": "Something went wrong. Please try again.",
    "networkError": "No connection. Check your network and try again."
  }
```

- [ ] **Step 2: Add the French namespace to `messages/fr.json`** (same keys, same order):

```json
  "mobileSettings": {
    "hubTitle": "Paramètres",
    "hubProfile": "Profil",
    "hubNotifications": "Notifications",
    "hubLanguage": "Langue",
    "hubSecurity": "Sécurité",
    "hubSignInMethods": "Méthodes de connexion",
    "hubPhone": "Vérification du téléphone",
    "hubDeleteAccount": "Supprimer le compte",
    "languageTitle": "Langue",
    "languageEnglish": "English",
    "languageFrench": "Français",
    "languagePidgin": "Pidgin",
    "languageSaveFailed": "Impossible d'enregistrer votre langue. Veuillez réessayer.",
    "securityTitle": "Sécurité",
    "securityEmailRow": "E-mail",
    "securityChangeEmail": "Changer d'e-mail",
    "securityPasswordRow": "Mot de passe",
    "securitySetPassword": "Définir ou réinitialiser le mot de passe",
    "securitySetPasswordHint": "Nous enverrons un lien à votre adresse actuelle. L'ouvrir prouve que le compte est le vôtre.",
    "securityResetSent": "Consultez votre boîte de réception : un lien pour définir un nouveau mot de passe vous a été envoyé.",
    "phoneTitle": "Vérification du téléphone",
    "phoneNumberLabel": "Numéro WhatsApp",
    "phoneSendCode": "Envoyer le code",
    "phoneCodeLabel": "Code à 6 chiffres",
    "phoneConfirm": "Vérifier",
    "phoneResend": "Renvoyer le code",
    "phoneResendIn": "Renvoyer dans {seconds} s",
    "phoneVerified": "Vérifié : {masked}",
    "phoneUnavailable": "La vérification est indisponible pour le moment. Veuillez réessayer plus tard.",
    "phoneErrorInvalid": "Saisissez un numéro valide, avec l'indicatif de votre pays si vous êtes hors du Nigeria.",
    "phoneErrorCooldown": "Veuillez patienter un instant avant de demander un autre code.",
    "phoneErrorDailyLimit": "Trop de codes demandés aujourd'hui. Veuillez réessayer demain.",
    "phoneErrorSendFailed": "Impossible d'envoyer le message WhatsApp. Veuillez réessayer.",
    "phoneErrorCodeInvalid": "Saisissez le code à 6 chiffres.",
    "phoneErrorCodeMissing": "Demandez d'abord un nouveau code.",
    "phoneErrorCodeExpired": "Ce code a expiré. Demandez-en un nouveau.",
    "phoneErrorCodeWrong": "Ce code n'est pas correct.",
    "phoneErrorAttempts": "Trop de tentatives incorrectes. Demandez un nouveau code.",
    "deleteAccountTitle": "Supprimer le compte",
    "deleteFailed": "Impossible de terminer cette action. Veuillez réessayer.",
    "reauthRateLimited": "Trop de tentatives. Veuillez réessayer plus tard.",
    "linkingUnavailable": "Cette option n'est pas disponible pour le moment. Veuillez contacter le support.",
    "genericError": "Une erreur s'est produite. Veuillez réessayer.",
    "networkError": "Pas de connexion. Vérifiez votre réseau et réessayez."
  }
```

- [ ] **Step 3: Add the Pidgin namespace to `messages/pcm.json`**:

```json
  "mobileSettings": {
    "hubTitle": "Settings",
    "hubProfile": "Profile",
    "hubNotifications": "Notifications",
    "hubLanguage": "Language",
    "hubSecurity": "Security",
    "hubSignInMethods": "How you dey sign in",
    "hubPhone": "Phone verification",
    "hubDeleteAccount": "Delete account",
    "languageTitle": "Language",
    "languageEnglish": "English",
    "languageFrench": "Français",
    "languagePidgin": "Pidgin",
    "languageSaveFailed": "We no fit save your language. Abeg try again.",
    "securityTitle": "Security",
    "securityEmailRow": "Email",
    "securityChangeEmail": "Change email",
    "securityPasswordRow": "Password",
    "securitySetPassword": "Set or reset password",
    "securitySetPasswordHint": "We go send link go your current email. If you open am, e go show say na your account.",
    "securityResetSent": "Check your inbox, link dey there to set new password.",
    "phoneTitle": "Phone verification",
    "phoneNumberLabel": "WhatsApp number",
    "phoneSendCode": "Send code",
    "phoneCodeLabel": "6-digit code",
    "phoneConfirm": "Verify",
    "phoneResend": "Send code again",
    "phoneResendIn": "Send again in {seconds}s",
    "phoneVerified": "Verified: {masked}",
    "phoneUnavailable": "Verification no dey work now. Abeg try again later.",
    "phoneErrorInvalid": "Put correct phone number, add your country code if you no dey Nigeria.",
    "phoneErrorCooldown": "Abeg wait small before you ask for another code.",
    "phoneErrorDailyLimit": "You don ask for too many codes today. Abeg try again tomorrow.",
    "phoneErrorSendFailed": "We no fit send the WhatsApp message. Abeg try again.",
    "phoneErrorCodeInvalid": "Put the 6-digit code.",
    "phoneErrorCodeMissing": "Ask for new code first.",
    "phoneErrorCodeExpired": "That code don expire. Ask for new one.",
    "phoneErrorCodeWrong": "That code no correct.",
    "phoneErrorAttempts": "You don try wrong code too many times. Ask for new code.",
    "deleteAccountTitle": "Delete account",
    "deleteFailed": "We no fit finish that one. Abeg try again.",
    "reauthRateLimited": "You don try too many times. Abeg try again later.",
    "linkingUnavailable": "This one no dey work now. Abeg contact support.",
    "genericError": "Something happen. Abeg try again.",
    "networkError": "No network. Check your connection and try again."
  }
```

- [ ] **Step 4: Run the parity test**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: PASS (identical key sets). A fail means a typo in one file's key names.

- [ ] **Step 5: Commit**

```bash
git add messages
git commit -m "feat(i18n): copy for the mobile settings screens (en, fr, pcm)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Staging rollout and merge (owner-gated)

**Files:** none (operations).

- [ ] **Step 1: Apply the migration to staging.** Use the Supabase MCP or CLI against the **staging** project (see memory `project_mobile_phase5_device_pass.md` for the staging project reference). Verify: `select count(*) from public.account_rate_limit_events;` returns 0 and `select jobname from cron.job where jobname = 'prune-account-rate-limit-events';` returns one row.

- [ ] **Step 2: Smoke the endpoints on a staging deployment** with a `zzqa_` account and a bearer token (not a Vercel preview, which hits production): `GET /me/account`; `PUT /me/locale {"locale":"pcm"}` then `GET /me/account` shows `pcm`; `POST /me/deletion {"confirm":"DELETE"}` then `DELETE /me/deletion`; `POST /me/phone/code` returns 503 `phone_unavailable` if `META_WHATSAPP_*` are unset on staging, otherwise 200. Record results in `TESTING-NOTES.md` in the mobile repo.

- [ ] **Step 3: Owner action: Supabase Manual Linking.** Confirm **Manual Linking** is enabled and the app redirect URL is allowlisted on staging and production (Auth settings). Without it, `DELETE /me/identities/google` answers `linking_unavailable` and mobile Link Google cannot work. Record who did it and when.

- [ ] **Step 4: Merge and push.** `git checkout main && git merge --no-ff phase6e/settings-account && git push origin main` (owner's standing preference is to merge and push finished branches immediately). Then ask the owner to apply the migration to **production**; do not apply it without their go-ahead.

- [ ] **Step 5: Re-copy the contract into the mobile repo** (done in the mobile plan's Task 1).

---

## Self-review against the spec

- **§3.2 endpoints:** all nine are Task 7 (`getMyAccount`, deletion x3, phone x2, email, unlink, locale). Set-password and Link-Google add no endpoint, as the spec says; the mobile plan covers both.
- **§3.3 corrections:** locale endpoint (Tasks 6-7), unlink password (Task 3), `phone_unavailable` (Tasks 5, 7).
- **§3.4 error codes:** `deletion_blocked`, `username_mismatch`, `confirm_required`, `phone_*`, email codes, `not_linked`, `last_identity`, `linking_unavailable`, `wrong_password`, `reauth_rate_limited`. `locale_invalid` is covered by the zod enum (validation 400) rather than a handler code, which is a deliberate simplification of the spec's list. `password_required` is covered by `changeEmailSchema`/zod `min(1)` (validation 400) on both password endpoints.
- **§3.5 limits:** OTP daily cap and re-auth limiter are Tasks 1, 5, 7.
- **§7 owner actions:** Task 9.
- **Added after reading the mobile gate (not in the spec):** Task 7b (`phoneVerifiedAt` on `/me`). Without it `/onboarding/phone` would gate every user, verified or not, once the flag flips. Fold into the spec when it is next edited.
- **Spec §5 stage 2 mentions "decided in the plan" for the cap's storage:** decided here as the new `account_rate_limit_events` table.
- **Known deviations from the spec text to fix in the spec after execution:** (1) the OTP channel is the Meta WhatsApp Cloud API (`META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`), not Termii; (2) `passwordIdentity` is documented as a hint.
