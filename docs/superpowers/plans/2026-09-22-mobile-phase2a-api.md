# Mobile Phase 2a API (web repo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/api/mobile/v1` endpoints and the `api_idempotency_keys` infrastructure that Mobile Phase 2a (tournaments list/detail/registration) depends on, in the web repo, without changing any existing web behavior.

**Architecture:** Per-domain service-function extraction (§7.1 of the master mobile spec): each existing Server Action's body moves into a plain, client-injected service function; the Server Action becomes a thin wrapper calling it; a new `defineEndpoint`-based route calls the same function. A new shared `runIdempotent()` primitive (claim → fill → reclaim, generation-gated) is wired into `defineEndpoint` via an `idempotent: true` option, used by the two money-creating POSTs.

**Tech Stack:** Next.js 14 API routes, zod, Supabase (`supabase-js`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-mobile-phase2a-tournaments-registration-design.md` — read this in full before starting; this plan implements §4, §5, and the flavor/staging notes in §2 (staging sync only; the staging project itself already exists).

## Global Constraints

- **Never change existing web behavior.** Every extraction is a pure refactor — the Server Action's existing test file must stay green, unmodified, after its extraction task.
- **Never write via PostgREST from a mobile write path.** All T3 writes go through `ctx.admin` (service role) exactly as the existing Server Actions already do — never `ctx.userClient` for a write.
- **Idempotency is Stripe-style: same key replays the same stored response, success or error, always.** No endpoint may special-case "this error is safe to not-cache."
- **`route` for idempotency purposes is the concrete request path** (`new URL(req.url).pathname`, e.g. `/api/mobile/v1/tournaments/abc-123/register`), never the route template — two different tournaments must never share an idempotency-key namespace even if a client bug reused a key.
- **Migration filenames are UTC-timestamp-prefixed**, never sequential (CLAUDE.md rule). This plan's migration is `20260922210000_api_idempotency_keys.sql` — confirmed safely after the latest real file on `origin/main` (`20260918210000_fcm_tokens_platform.sql`).
- **Squads are deliberately deferred in 2a**, not blocked — `POST /tournaments/{id}/register` accepts `squadId` in its body type but rejects a non-null value with `400 squads_not_available`; the extracted service function itself must NOT lose the web's existing squad-handling code (it's a faithful extraction, squads still work for the web Server Action's own callers).
- **`resolveRegistrationView()` is reused, not reimplemented** — `GET /tournaments/{id}/registration-state` calls the real `lib/tournaments/view.ts` function for its view-state, and adds waiver/coin-discount composition on top; it must not duplicate `resolveRegistrationView`'s branching logic.
- Every new test file follows the hand-rolled-fake convention already established in this repo (see `lib/onboarding/claim-username-service.test.ts`) — no new mocking library.
- Run `npx tsc --noEmit` and `npm run test` before every commit that touches more than a test file; both must be clean.

---

### Task 1: `api_idempotency_keys` migration, applied to both staging and (via normal deploy) production

**Files:**
- Create: `supabase/migrations/20260922210000_api_idempotency_keys.sql`

**Interfaces:**
- Produces: table `api_idempotency_keys(key text, user_id uuid, route text, response jsonb, status_code int, created_at timestamptz, completed_at timestamptz)`, primary key `(key, user_id, route)`, RLS enabled with zero policies (service-role-only, matching `banned_identifiers`/`retired_usernames`/`notifications`).

- [ ] **Step 1: Write the migration file**

```sql
-- api_idempotency_keys: claim/fill/reclaim backing store for T3 POSTs that
-- declare idempotent: true in defineEndpoint (mobile spec S4). Service-role
-- only — no client, mobile or web, ever reads or writes this table directly.
create table api_idempotency_keys (
  key text not null,
  user_id uuid not null references auth.users(id),
  route text not null,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (key, user_id, route)
);

alter table api_idempotency_keys enable row level security;
-- No policies: authenticated/anon get zero access. Only the service-role
-- client (which bypasses RLS) touches this table.
```

- [ ] **Step 2: Apply to the staging project via the Supabase MCP tools**

Run `mcp__claude_ai_Supabase__apply_migration` with `project_id: "ofxmoxpvwbemfouaowoa"`, `name: "api_idempotency_keys"`, and the SQL body above. This keeps staging in sync per the spec's §2 requirement ("every new migration merged to `origin/main` must also be applied to staging").

- [ ] **Step 3: Verify the table exists on staging**

Run `mcp__claude_ai_Supabase__list_tables` with `project_id: "ofxmoxpvwbemfouaowoa"`, `schemas: ["public"]`. Confirm `api_idempotency_keys` appears with `rls_enabled: true`.

- [ ] **Step 4: Regenerate Supabase TypeScript types**

Run: `npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts` (uses production as the type source per existing convention — this migration will reach production through the normal deploy pipeline; staging already has it from Step 2, keeping the two schema-identical as the spec requires).

Note: if this command fails locally (see project memory on Supabase CLI connectivity gaps), use `mcp__claude_ai_Supabase__generate_typescript_types` with `project_id: "itxubrkbropttfdackmi"` against production instead, once the migration has also been applied there through the normal PR-merge deploy flow — do not block this task on that; hand-add the `api_idempotency_keys` row shape to `lib/supabase/types.ts` in the interim if needed for later tasks to type-check, matching the shape in Step 1.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260922210000_api_idempotency_keys.sql lib/supabase/types.ts
git commit -m "feat(db): add api_idempotency_keys table for mobile T3 writes"
```

---

### Task 2: `runIdempotent()` — the claim/fill/reclaim primitive

**Files:**
- Create: `lib/mobile-api/idempotency.ts`
- Create: `lib/mobile-api/idempotency.test.ts`

**Interfaces:**
- Consumes: `Database` type from `@/lib/supabase/types` (Task 1's migration must be reflected there, or the hand-added interim shape).
- Produces: `runIdempotent(admin, {key, userId, route}, run: () => Promise<{status: number; body: unknown}>) => Promise<{status: number; body: unknown} | {conflict: true}>` — used by Task 4 (`defineEndpoint`'s `idempotent` option). `{conflict: true}` means: caller should surface a `409 idempotency_in_progress` to the client; `runIdempotent` itself never throws or shapes an `ApiError`, that's Task 4's job.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/mobile-api/idempotency.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runIdempotent } from './idempotency'

interface Row {
  key: string
  user_id: string
  route: string
  response: unknown
  status_code: number | null
  created_at: string
  completed_at: string | null
}

function fakeAdmin(seed: Row[] = []) {
  const rows: Row[] = seed
  function match(r: Row, filters: Record<string, unknown>) {
    return Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
  }
  function filterBuilder(onSelect: (filters: Record<string, unknown>) => unknown) {
    const filters: Record<string, unknown> = {}
    const b = {
      eq(col: string, val: unknown) { filters[col] = val; return b },
      is(col: string, val: null) { filters[col] = val; return b },
      select: async (_cols: string) => onSelect(filters),
      maybeSingle: async () => {
        const row = rows.find((r) => match(r, filters))
        return { data: row ? { ...row } : null }
      },
    }
    return b
  }
  const admin = {
    from(table: string) {
      if (table !== 'api_idempotency_keys') throw new Error(`unexpected table ${table}`)
      return {
        insert(values: { key: string; user_id: string; route: string }) {
          return {
            select: async (_cols: string) => {
              if (rows.some((r) => r.key === values.key && r.user_id === values.user_id && r.route === values.route)) {
                return { data: null, error: { code: '23505' } }
              }
              const row: Row = { key: values.key, user_id: values.user_id, route: values.route, response: null, status_code: null, created_at: new Date().toISOString(), completed_at: null }
              rows.push(row)
              return { data: [{ created_at: row.created_at }], error: null }
            },
          }
        },
        update(patch: Partial<Row>) {
          return filterBuilder((filters) => {
            const row = rows.find((r) => match(r, filters))
            if (!row) return { data: [], error: null }
            Object.assign(row, patch)
            return { data: [{ created_at: row.created_at }], error: null }
          })
        },
        select(_cols: string) {
          return filterBuilder(() => { throw new Error('select() must terminate with maybeSingle() in this fake') })
        },
      }
    },
  }
  return { admin: admin as never, rows }
}

const args = { key: 'k1', userId: 'u1', route: '/tournaments/t1/register' }

describe('runIdempotent', () => {
  it('claims, runs, and returns the result on a fresh key', async () => {
    const { admin, rows } = fakeAdmin()
    const run = vi.fn().mockResolvedValue({ status: 200, body: { data: { ok: true } } })
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { ok: true } } })
    expect(run).toHaveBeenCalledTimes(1)
    expect(rows[0].completed_at).not.toBeNull()
    expect(rows[0].response).toEqual({ data: { ok: true } })
  })

  it('replays the stored response without re-running, including an error response', async () => {
    const seeded: Row = { key: 'k1', user_id: 'u1', route: args.route, response: { error: { code: 'tournament_full', message: 'Full.' } }, status_code: 400, created_at: new Date().toISOString(), completed_at: new Date().toISOString() }
    const { admin } = fakeAdmin([seeded])
    const run = vi.fn()
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 400, body: { error: { code: 'tournament_full', message: 'Full.' } } })
    expect(run).not.toHaveBeenCalled()
  })

  it('polls and returns the winner\'s response when a concurrent claim completes before the staleness mark', async () => {
    const seeded: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date().toISOString(), completed_at: null }
    const { admin, rows } = fakeAdmin([seeded])
    const run = vi.fn()
    setTimeout(() => {
      rows[0].completed_at = new Date().toISOString()
      rows[0].status_code = 200
      rows[0].response = { data: { ok: 'from-the-other-request' } }
    }, 100)
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { ok: 'from-the-other-request' } } })
    expect(run).not.toHaveBeenCalled()
  }, 10_000)

  it('reclaims a stale claim (>=30s old, never completed) and runs the service function itself', async () => {
    const stale: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date(Date.now() - 31_000).toISOString(), completed_at: null }
    const { admin, rows } = fakeAdmin([stale])
    const run = vi.fn().mockResolvedValue({ status: 200, body: { data: { reclaimed: true } } })
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { reclaimed: true } } })
    expect(run).toHaveBeenCalledTimes(1)
    expect(rows[0].completed_at).not.toBeNull()
  })

  it('discards a superseded fill (original holder finishes after a reclaim already completed) and returns the current response instead', async () => {
    const originalGeneration = new Date(Date.now() - 31_000).toISOString()
    const { admin, rows } = fakeAdmin([{ key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: originalGeneration, completed_at: null }])
    // Simulate: between runIdempotent's claim-check and its fill, another
    // request already reclaimed and completed this key at a NEW generation.
    const run = vi.fn().mockImplementation(async () => {
      rows[0].created_at = new Date().toISOString() // the reclaimer's new generation
      rows[0].completed_at = new Date().toISOString()
      rows[0].status_code = 200
      rows[0].response = { data: { fromReclaimer: true } }
      return { status: 200, body: { data: { fromOriginal: true } } }
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Directly exercise the reclaim path: seed as already-stale so
    // runIdempotent takes the reclaim branch, then `run` mutates the row to
    // simulate a second reclaimer finishing first.
    const result = await runIdempotent(admin, args, run)
    expect(result).toEqual({ status: 200, body: { data: { fromReclaimer: true } } })
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('superseded'), expect.anything())
    spy.mockRestore()
  })

  it('returns conflict when a double-reclaim race leaves nothing completed', async () => {
    const stale: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date(Date.now() - 31_000).toISOString(), completed_at: null }
    const { admin, rows } = fakeAdmin([stale])
    const run = vi.fn().mockImplementation(async () => {
      // A second reclaimer wins the CAS between our select and our update by
      // changing created_at to something we won't match.
      rows[0].created_at = new Date().toISOString()
      return { status: 200, body: { data: {} } }
    })
    // Force the race: reclaim inside runIdempotent will observe the original
    // stale created_at, but by the time its own CAS update runs, `run` above
    // won't have executed yet (run only fires after a *successful* claim) —
    // so instead, seed a second stale row scenario by racing the reclaim
    // update itself: pre-mutate created_at before runIdempotent starts.
    rows[0].created_at = new Date().toISOString() // no longer stale, but completed_at still null and <30s old
    const result = await runIdempotent(admin, { ...args }, run)
    // Not stale yet and not completed — this exercises the poll path, which
    // times out (no timers advance it) unless we let it observe. Adjust:
    expect(result).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mobile-api/idempotency.test.ts`
Expected: FAIL with "Cannot find module './idempotency'" or similar — `idempotency.ts` doesn't exist yet.

- [ ] **Step 3: Fix the last test — it's testing the wrong thing, replace it before implementing**

The last test above ("double-reclaim race") doesn't actually construct the race it claims to. Replace it with a version that seeds a row already reclaimed by someone else with a **different, non-matching `created_at`**, then calls `runIdempotent` a second time so its own claim-check sees the row as freshly non-stale (racing reclaimer won) and falls into the poll branch, which this test lets time out by never completing the row — asserting `{ conflict: true }`:

```typescript
  it('returns conflict when the poll window elapses with no completion and the row is not yet stale enough to reclaim', async () => {
    // A row that is NOT stale (created 1s ago) and never completes within
    // this test's patience — runIdempotent must not hang forever; it should
    // give up and report conflict once it independently decides the wait
    // isn't worth extending further. This exercises the "still genuinely
    // in-flight, not ours to touch" case distinct from staleness.
    const inFlight: Row = { key: 'k1', user_id: 'u1', route: args.route, response: null, status_code: null, created_at: new Date().toISOString(), completed_at: null }
    const { admin } = fakeAdmin([inFlight])
    const run = vi.fn()
    // 29s of real polling is too slow for a unit test — cap POLL_MAX_WAIT_MS
    // via the exported constant so this test finishes fast without changing
    // production behavior (see idempotency.ts Step 4 below for the export).
    const result = await runIdempotent(admin, args, run, { pollMaxWaitMs: 300, pollIntervalMs: 50 })
    expect(result).toEqual({ conflict: true })
    expect(run).not.toHaveBeenCalled()
  })
```

This requires `runIdempotent` to accept an optional 4th argument overriding its poll timing — production code omits it and gets the real 30s/500ms defaults; tests use a short override. Update the "polls and returns the winner's" test above to also pass `{ pollIntervalMs: 50 }` so it doesn't need the real 100ms `setTimeout` window to race a 500ms poll — tighten that test's `setTimeout` delay to `20` accordingly.

- [ ] **Step 4: Write the implementation**

```typescript
// lib/mobile-api/idempotency.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export interface IdempotentResult {
  status: number
  body: unknown
}

export const DEFAULT_STALE_MS = 30_000
export const DEFAULT_POLL_INTERVAL_MS = 500

interface Row {
  created_at: string
  completed_at: string | null
  status_code: number | null
  response: unknown
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function selectRow(admin: Admin, args: { key: string; userId: string; route: string }): Promise<Row | null> {
  const { data } = await admin
    .from('api_idempotency_keys')
    .select('created_at, completed_at, status_code, response')
    .eq('key', args.key)
    .eq('user_id', args.userId)
    .eq('route', args.route)
    .maybeSingle()
  return (data as Row | null) ?? null
}

async function fillClaim(
  admin: Admin,
  args: { key: string; userId: string; route: string },
  generation: string,
  run: () => Promise<IdempotentResult>,
): Promise<IdempotentResult | { conflict: true }> {
  const result = await run()
  const filled = await admin
    .from('api_idempotency_keys')
    .update({ response: result.body, status_code: result.status, completed_at: new Date().toISOString() })
    .eq('key', args.key)
    .eq('user_id', args.userId)
    .eq('route', args.route)
    .eq('created_at', generation)
    .is('completed_at', null)
    .select('created_at')
  if (filled.error || !filled.data || filled.data.length === 0) {
    // The side-effecting work in run() already happened for nothing — a
    // rising rate of this log is the signal the staleness threshold (spec
    // S4.2) is too tight relative to real request latency.
    console.error('[idempotency] superseded fill discarded', { key: args.key, userId: args.userId, route: args.route })
    const current = await selectRow(admin, args)
    if (current?.completed_at) return { status: current.status_code!, body: current.response }
    return { conflict: true }
  }
  return result
}

// Stripe-style: the same key always replays the same stored response,
// success or error — never distinguishes "safe to retry fresh" errors from
// any other kind. A client resubmitting materially new information must
// mint a fresh key (mobile spec S6.3 step 6).
export async function runIdempotent(
  admin: Admin,
  args: { key: string; userId: string; route: string },
  run: () => Promise<IdempotentResult>,
  opts: { staleMs?: number; pollIntervalMs?: number; pollMaxWaitMs?: number } = {},
): Promise<IdempotentResult | { conflict: true }> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const pollMaxWaitMs = opts.pollMaxWaitMs ?? staleMs

  const claimed = await admin
    .from('api_idempotency_keys')
    .insert({ key: args.key, user_id: args.userId, route: args.route })
    .select('created_at')
  if (!claimed.error && claimed.data && claimed.data.length > 0) {
    return fillClaim(admin, args, (claimed.data[0] as { created_at: string }).created_at, run)
  }

  let row = await selectRow(admin, args)
  if (!row) return { conflict: true }

  const pollDeadline = Date.now() + pollMaxWaitMs
  while (!row.completed_at) {
    const ageMs = Date.now() - new Date(row.created_at).getTime()
    if (ageMs < staleMs) {
      if (Date.now() >= pollDeadline) return { conflict: true }
      await sleep(pollIntervalMs)
      row = await selectRow(admin, args)
      if (!row) return { conflict: true }
      continue
    }
    const reclaimed = await admin
      .from('api_idempotency_keys')
      .update({ created_at: new Date().toISOString(), response: null, status_code: null, completed_at: null })
      .eq('key', args.key)
      .eq('user_id', args.userId)
      .eq('route', args.route)
      .eq('created_at', row.created_at)
      .is('completed_at', null)
      .select('created_at')
    if (!reclaimed.error && reclaimed.data && reclaimed.data.length > 0) {
      return fillClaim(admin, args, (reclaimed.data[0] as { created_at: string }).created_at, run)
    }
    row = await selectRow(admin, args)
    if (!row) return { conflict: true }
    if (!row.completed_at) return { conflict: true }
  }
  return { status: row.status_code!, body: row.response }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/idempotency.test.ts`
Expected: PASS, all 6 tests (the "returns conflict when a double-reclaim race..." test from Step 1 has been replaced by Step 3's version — delete the Step-1 version from the file before running).

- [ ] **Step 6: Commit**

```bash
git add lib/mobile-api/idempotency.ts lib/mobile-api/idempotency.test.ts
git commit -m "feat(mobile-api): add runIdempotent claim/fill/reclaim primitive"
```

---

### Task 3: `defineEndpoint` — path param support

Every existing endpoint has a static path. This phase's endpoints all have a
dynamic segment (`{id}` or `{reference}`), which `defineEndpoint` has never
had to pass through before.

**Files:**
- Modify: `lib/mobile-api/define-endpoint.ts`
- Modify: `lib/mobile-api/define-endpoint.test.ts`

**Interfaces:**
- Produces: `Endpoint.handler` type becomes `(req: Request, context?: { params: Record<string, string> }) => Promise<Response>` (was `(req: Request) => Promise<Response>`) — backward compatible, Next.js already calls route handlers with a second `context` argument for dynamic segments and existing static routes simply receive `undefined`/an empty one. The handler's `def.handler` input gains a `params: Record<string, string>` field alongside `ctx`/`body`/`req`.

- [ ] **Step 1: Write the failing test**

Add to `lib/mobile-api/define-endpoint.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mobile-api/define-endpoint.test.ts`
Expected: FAIL — `params` is `undefined` in the handler, `params.id` throws, and TypeScript itself will already flag the missing `params` field on the handler input type before the test even runs.

- [ ] **Step 3: Update the implementation**

In `lib/mobile-api/define-endpoint.ts`, change the `Endpoint` interface and `defineEndpoint`'s handler signature and inner function:

```typescript
export interface Endpoint {
  meta: EndpointMeta
  handler: (req: Request, context?: { params: Record<string, string> }) => Promise<Response>
}
```

```typescript
  handler: (input: {
    ctx: A extends 'public' ? MobileCtx | null : MobileCtx
    body: z.infer<TBody>
    req: Request
    params: Record<string, string>
  }) => Promise<z.infer<TRes>>
```

```typescript
  async function handler(req: Request, context?: { params: Record<string, string> }): Promise<Response> {
    try {
      // ...unchanged version-gate and auth blocks...

      const result = await def.handler({ ctx: ctx as never, body: body as never, req, params: context?.params ?? {} })
      const data = def.response.parse(result)
      return json(200, { data }, def.cacheControl)
    } catch (e) {
      // ...unchanged...
    }
  }
```

(Only the `handler` function's signature and the `def.handler({...})` call site change — the version-gate, auth, and body-parsing blocks in between are untouched by this task.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/define-endpoint.test.ts`
Expected: PASS, all tests including the two new ones and every pre-existing one (confirms this is backward compatible).

- [ ] **Step 5: Commit**

```bash
git add lib/mobile-api/define-endpoint.ts lib/mobile-api/define-endpoint.test.ts
git commit -m "feat(mobile-api): defineEndpoint passes route params to handlers"
```

---

### Task 4: `defineEndpoint` — `idempotent: true` option

Wires Task 2's `runIdempotent` into `defineEndpoint` so any endpoint can opt in
with one boolean, without reimplementing claim/fill/reclaim itself.

**Files:**
- Modify: `lib/mobile-api/define-endpoint.ts`
- Modify: `lib/mobile-api/define-endpoint.test.ts`
- Modify: `lib/mobile-api/errors.ts`

**Interfaces:**
- Consumes: `runIdempotent` from `./idempotency` (Task 2).
- Produces: `defineEndpoint(def: { ..., idempotent?: boolean })` — when `true`, requires `Idempotency-Key` on every request (`400 idempotency_key_required` if missing), scopes by `new URL(req.url).pathname` + `ctx.userId`, and returns `409 idempotency_in_progress` on an unresolved conflict. Used by Task 7 (register) and Task 9 (invitation accept).

- [ ] **Step 1: Write the failing tests**

Add to `lib/mobile-api/define-endpoint.test.ts` (needs `vi.mock('./idempotency', ...)` alongside the existing `./auth` mock at the top of the file):

```typescript
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('./idempotency', () => ({ runIdempotent }))
```

```typescript
  it('requires an Idempotency-Key header on an idempotent endpoint', async () => {
    authenticate.mockResolvedValue(ctx())
    const idem = defineEndpoint({
      operationId: 'postIdem', method: 'POST', path: '/idem', summary: 'i', auth: 'user', idempotent: true,
      response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    const res = await call(idem, { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('idempotency_key_required')
    expect(runIdempotent).not.toHaveBeenCalled()
  })

  it('runs through runIdempotent, scoped by the concrete request path and userId', async () => {
    authenticate.mockResolvedValue(ctx({ userId: 'u9' }))
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    const idem = defineEndpoint({
      operationId: 'postIdem2', method: 'POST', path: '/tournaments/{id}/register', summary: 'i', auth: 'user', idempotent: true,
      response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t42/register', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'idempotency-key': 'key-1' },
    })
    const res = await idem.handler(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { ok: true } })
    expect(runIdempotent).toHaveBeenCalledWith(
      expect.anything(),
      { key: 'key-1', userId: 'u9', route: '/api/mobile/v1/tournaments/t42/register' },
      expect.any(Function),
    )
  })

  it('returns 409 idempotency_in_progress on an unresolved conflict', async () => {
    authenticate.mockResolvedValue(ctx())
    runIdempotent.mockResolvedValue({ conflict: true })
    const idem = defineEndpoint({
      operationId: 'postIdem3', method: 'POST', path: '/idem3', summary: 'i', auth: 'user', idempotent: true,
      response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
    })
    const res = await call(idem, { method: 'POST', body: '{}', headers: { 'idempotency-key': 'k' } } as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('idempotency_in_progress')
  })

  it('replays a stored ERROR response verbatim on a replayed key, without re-running the handler', async () => {
    authenticate.mockResolvedValue(ctx())
    runIdempotent.mockResolvedValue({ status: 422, body: { error: { code: 'tournament_full', message: 'Full.' } } })
    const handlerFn = vi.fn()
    const idem = defineEndpoint({
      operationId: 'postIdem4', method: 'POST', path: '/idem4', summary: 'i', auth: 'user', idempotent: true,
      response: z.object({ ok: z.boolean() }), handler: handlerFn,
    })
    const res = await call(idem, { method: 'POST', body: '{}', headers: { 'idempotency-key': 'k' } } as never)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: { code: 'tournament_full', message: 'Full.' } })
  })
```

Update the `call` helper at the top of the file to accept extra headers if it doesn't already (check Task 3's final state — the existing `call` helper already takes a third `headers` argument, reuse it: `call(idem, { method: 'POST', body: '{}' }, { 'idempotency-key': 'k' })` instead of stuffing headers into `init` — fix the three tests above to use that third argument rather than `headers` inside `init`, matching the file's existing convention exactly).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mobile-api/define-endpoint.test.ts`
Expected: FAIL — `idempotent` isn't a recognized option yet (TypeScript error) and `idempotency_key_required` is never thrown.

- [ ] **Step 3: Add the two new error codes**

In `lib/mobile-api/errors.ts`, add to the `Errors` object:

```typescript
  idempotencyKeyRequired: () =>
    new ApiError(400, 'idempotency_key_required', 'An Idempotency-Key header is required for this request.'),
  idempotencyInProgress: () =>
    new ApiError(409, 'idempotency_in_progress', 'Try again shortly with the same Idempotency-Key.'),
```

- [ ] **Step 4: Restructure `defineEndpoint`'s handler**

Replace the body of the inner `handler` function in `lib/mobile-api/define-endpoint.ts` (everything after the auth/body-parsing block that was already there) with:

```typescript
      const runOnce = async (): Promise<{ status: number; body: unknown }> => {
        try {
          const result = await def.handler({ ctx: ctx as never, body: body as never, req, params: context?.params ?? {} })
          const data = def.response.parse(result)
          return { status: 200, body: { data } }
        } catch (e) {
          if (e instanceof ApiError) return { status: e.status, body: errorBody(e) }
          console.error('[mobile-api] unhandled', { path: def.path, message: e instanceof Error ? e.message : String(e) })
          return { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } }
        }
      }

      if (def.idempotent) {
        const key = req.headers.get('idempotency-key')
        if (!key) throw Errors.idempotencyKeyRequired()
        const userId = (ctx as MobileCtx).userId
        const outcome = await runIdempotent(
          (ctx as MobileCtx).admin,
          { key, userId, route: new URL(req.url).pathname },
          runOnce,
        )
        if ('conflict' in outcome) throw Errors.idempotencyInProgress()
        return json(outcome.status, outcome.body, def.cacheControl)
      }

      const outcome = await runOnce()
      return json(outcome.status, outcome.body, def.cacheControl)
```

Add the import at the top of the file: `import { runIdempotent } from './idempotency'`. Add `idempotent?: boolean` to the `def` parameter's type in `defineEndpoint`'s signature (alongside `cacheControl?` and `skipVersionGate?`). The outer `try { ... } catch (e) { if (e instanceof ApiError) return json(e.status, errorBody(e)) ... }` wrapping the whole function body stays exactly as it was — it now only ever catches version-gate/auth/body-parsing throws, since `runOnce` internally catches everything from `def.handler` itself.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/define-endpoint.test.ts`
Expected: PASS, all tests — including every pre-existing test from before this task (confirms the restructure preserved behavior for non-idempotent endpoints).

- [ ] **Step 6: Run the full web test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/mobile-api/define-endpoint.ts lib/mobile-api/define-endpoint.test.ts lib/mobile-api/errors.ts
git commit -m "feat(mobile-api): add idempotent option to defineEndpoint"
```

---

### Task 5: `PATCH /me/profile`

**Files:**
- Create: `lib/profile/update-profile-service.ts`
- Create: `lib/profile/update-profile-service.test.ts`
- Modify: `lib/profile/actions.ts` (thin wrapper)
- Modify: `lib/mobile-api/endpoints/me.ts` (add the endpoint)
- Modify: `lib/mobile-api/endpoints/me.test.ts`
- Modify: `app/api/mobile/v1/me/route.ts` (add `PATCH` export)
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `profileEditSchema` from `@/lib/profile/schema` (reused unmodified — no `locale` field, confirmed against the real schema; spec §5.1's correction to the master catalogue holds).
- Produces: `performUpdateProfile(supabase, admin, userId, input: {displayName, username, whatsapp, country, bio, avatarUrl?}) => Promise<{ok: true} | {ok: false; errorCode: 'username_taken'|'username_locked'|'save_failed'}>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/profile/update-profile-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performUpdateProfile } from './update-profile-service'

function fakeSupabase(current: { username: string | null; username_changed_at: string | null }) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current }) }) }) }) } as never
}

function fakeAdmin(opts: { updateError?: { code?: string } | null } = {}) {
  const eq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn(() => ({ eq }))
  const admin = { from: (table: string) => {
    if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
    return { update }
  } } as never
  return { admin, update, eq }
}

const baseInput = { displayName: 'New Name', username: '', whatsapp: '', country: '', bio: '' }

describe('performUpdateProfile', () => {
  it('saves display name/whatsapp/country/bio without touching username when username is blank', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performUpdateProfile(fakeSupabase({ username: 'existing', username_changed_at: null }), admin, 'u1', baseInput)
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ display_name: 'New Name', whatsapp_number: null, country: null, bio: null })
  })

  it('allows a first-time username change and stamps username_changed_at', async () => {
    const { admin, update } = fakeAdmin()
    const result = await performUpdateProfile(fakeSupabase({ username: 'old', username_changed_at: null }), admin, 'u1', { ...baseInput, username: 'newname' })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname', username_changed_at: expect.any(String) }))
  })

  it('rejects a second username change', async () => {
    const { admin } = fakeAdmin()
    const result = await performUpdateProfile(fakeSupabase({ username: 'old', username_changed_at: '2026-01-01T00:00:00Z' }), admin, 'u1', { ...baseInput, username: 'newname' })
    expect(result).toEqual({ ok: false, errorCode: 'username_locked' })
  })

  it('maps a unique-violation on username to username_taken', async () => {
    const { admin } = fakeAdmin({ updateError: { code: '23505' } })
    const result = await performUpdateProfile(fakeSupabase({ username: 'old', username_changed_at: null }), admin, 'u1', { ...baseInput, username: 'taken' })
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('includes avatarUrl in the patch only when provided', async () => {
    const { admin, update } = fakeAdmin()
    await performUpdateProfile(fakeSupabase({ username: 'x', username_changed_at: null }), admin, 'u1', { ...baseInput, avatarUrl: 'https://cdn/a.webp' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: 'https://cdn/a.webp' }))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/profile/update-profile-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/profile/update-profile-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ProfileEditInput } from './schema'

type Admin = ReturnType<typeof createAdminClient>

export type UpdateProfileErrorCode = 'username_taken' | 'username_locked' | 'save_failed'
export type UpdateProfileResult = { ok: true } | { ok: false; errorCode: UpdateProfileErrorCode }

// Extracted from lib/profile/actions.ts's updateProfile() — the Server
// Action and PATCH /me/profile both call this. No locale field: the real
// action never had one (spec S5.1's correction to the master catalogue).
export async function performUpdateProfile(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  input: ProfileEditInput & { avatarUrl?: string },
): Promise<UpdateProfileResult> {
  const avatarPatch = input.avatarUrl ? { avatar_url: input.avatarUrl } : {}

  let usernamePatch: { username?: string; username_changed_at?: string } = {}
  if (input.username) {
    const { data: current } = await supabase
      .from('profiles')
      .select('username, username_changed_at')
      .eq('id', userId)
      .maybeSingle()
    if (current && current.username !== input.username) {
      if (current.username_changed_at) return { ok: false, errorCode: 'username_locked' }
      usernamePatch = { username: input.username, username_changed_at: new Date().toISOString() }
    }
  }

  const { error } = await admin
    .from('profiles')
    .update({
      display_name: input.displayName,
      whatsapp_number: input.whatsapp || null,
      country: input.country || null,
      bio: input.bio || null,
      ...avatarPatch,
      ...usernamePatch,
    })
    .eq('id', userId)
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, errorCode: 'username_taken' }
    return { ok: false, errorCode: 'save_failed' }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/profile/update-profile-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service, and confirm its existing test (if any) stays green**

`lib/profile/actions.ts`'s `updateProfile` becomes a thin wrapper: parse `formData` with `profileEditSchema` exactly as before, call `performUpdateProfile(createClient(), createAdminClient(), user.id, {...parsed.data, avatarUrl: ...})`, map the result to the existing `ProfileEditState` shape (`{error: 'That username is already taken.'}` for `username_taken`, `{error: 'Username has already been changed once.'}` for `username_locked`, `{error: 'Could not save your profile. Please try again.'}` for `save_failed`, `{success: true}` on `ok: true`), then keep the existing `checkAndUnlockAchievements`/`revalidatePath` calls exactly where they were, after the service call succeeds.

Run: `find lib/profile -iname "*actions.test.ts"` first — if no such file exists (confirmed absent during spec research), skip to Step 6; there is nothing to keep green because nothing already covers this Server Action.

- [ ] **Step 6: Write the failing test for the error-message mapper first**

Checked directly: `lib/mobile-api/endpoints/me.test.ts` only tests the pure `toMeResponse` mapper — this repo's convention is that individual endpoint files unit-test their own pure logic (mappers, message lookups), while the generic HTTP-envelope/error-throwing machinery is already covered once, generically, in `define-endpoint.test.ts` (Tasks 3–4). Follow that convention: extract the error-code→message lookup as its own small pure function, `updateProfileErrorMessage`, and test it directly rather than re-testing the HTTP layer per endpoint.

Add to `lib/mobile-api/endpoints/me.test.ts`:

```typescript
import { updateProfileErrorMessage } from './me'

describe('updateProfileErrorMessage', () => {
  it('maps each UpdateProfileErrorCode to a player-facing message', () => {
    expect(updateProfileErrorMessage('username_taken')).toBe('That username is already taken.')
    expect(updateProfileErrorMessage('username_locked')).toBe('Username has already been changed once.')
    expect(updateProfileErrorMessage('save_failed')).toBe('Could not save your profile. Please try again.')
  })
})
```

Run: `npx vitest run lib/mobile-api/endpoints/me.test.ts`
Expected: FAIL — `updateProfileErrorMessage` isn't exported from `./me` yet.

- [ ] **Step 7: Add the endpoint**

In `lib/mobile-api/endpoints/me.ts`, add below the existing `meEndpoint` (the file already has `z` imported at the top for `meResponse` — no new zod import needed):

```typescript
import { defineEndpoint } from '../define-endpoint'
import { profileEditSchema } from '@/lib/profile/schema'
import { performUpdateProfile, type UpdateProfileErrorCode } from '@/lib/profile/update-profile-service'
import { ApiError } from '../errors'

const updateProfileBody = profileEditSchema.extend({ avatarUrl: z.string().url().optional() })
const updateProfileResponse = z.object({ ok: z.literal(true) })

export function updateProfileErrorMessage(code: UpdateProfileErrorCode): string {
  const messages: Record<UpdateProfileErrorCode, string> = {
    username_taken: 'That username is already taken.',
    username_locked: 'Username has already been changed once.',
    save_failed: 'Could not save your profile. Please try again.',
  }
  return messages[code]
}

export const updateProfileEndpoint = defineEndpoint({
  operationId: 'patchMeProfile',
  method: 'PATCH',
  path: '/me/profile',
  summary: 'Update the signed-in player\'s own profile (display name, bio, country, one-time username change, avatar).',
  auth: 'user',
  body: updateProfileBody,
  response: updateProfileResponse,
  handler: async ({ ctx, body }) => {
    const result = await performUpdateProfile(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(400, result.errorCode, updateProfileErrorMessage(result.errorCode))
    return { ok: true as const }
  },
})
```

Run: `npx vitest run lib/mobile-api/endpoints/me.test.ts`
Expected: PASS, both the new test and the pre-existing `toMeResponse` tests.

- [ ] **Step 8: Wire the route and registry**

`app/api/mobile/v1/me/route.ts`:

```typescript
import { meEndpoint } from '@/lib/mobile-api/endpoints/me'
import { updateProfileEndpoint } from '@/lib/mobile-api/endpoints/me'

export const GET = meEndpoint.handler
export const PATCH = updateProfileEndpoint.handler
```

Wait — `PATCH /me/profile` is a **different path** (`/me/profile`) than `GET /me` (`/me`), so it needs its own route folder, not a second export in the same file. Create `app/api/mobile/v1/me/profile/route.ts`:

```typescript
import { updateProfileEndpoint } from '@/lib/mobile-api/endpoints/me'

export const PATCH = updateProfileEndpoint.handler
```

Leave `app/api/mobile/v1/me/route.ts` untouched (still just `GET`).

In `lib/mobile-api/endpoints/index.ts`, add `updateProfileEndpoint` to the imports from `./me` and to the `ALL_ENDPOINTS` array.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/profile/update-profile-service.ts lib/profile/update-profile-service.test.ts lib/profile/actions.ts lib/mobile-api/endpoints/me.ts lib/mobile-api/endpoints/me.test.ts app/api/mobile/v1/me/profile/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add PATCH /me/profile"
```

---

### Task 6: `GET /tournaments/{id}/registration-state`

**Files:**
- Create: `lib/tournaments/registration-state-service.ts`
- Create: `lib/tournaments/registration-state-service.test.ts`
- Create: `lib/mobile-api/endpoints/tournaments.ts`
- Create: `lib/mobile-api/endpoints/tournaments.test.ts`
- Create: `app/api/mobile/v1/tournaments/[id]/registration-state/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `resolveRegistrationView` + `RegView` from `@/lib/tournaments/view` (reused unmodified — confirmed tested, confirmed the real page consumer, per spec §5.2).
- Produces: `buildRegistrationState(supabase, admin, tournamentId, userId: string | null) => Promise<{view: RegView; feeNaira: number; hasWaiver: boolean; coinDiscountEligible: boolean; agreementRequired: boolean} | null>` (`null` = tournament not found). This is the first task in this phase's Compete domain, so `tournaments.ts` is created here, not modified.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/registration-state-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildRegistrationState } from './registration-state-service'

function fakeSupabase(opts: {
  tournament: { id: string; status: string; registration_fee: number; max_players: number | null; invitation_only: boolean; rules: string | null } | null
  paidCount?: number
  existing?: { id: string; payment_status: string; status: string } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament }) }) }) }
      }
      if (table === 'tournament_registrations') {
        return {
          select: (cols: string, meta?: { count?: string; head?: boolean }) => {
            if (meta?.count) return { eq: () => ({ eq: () => Promise.resolve({ count: opts.paidCount ?? 0 }) }) }
            return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

function fakeAdmin(opts: { waiver?: { id: string } | null } = {}) {
  return {
    from: (table: string) => {
      if (table !== 'tournament_fee_waivers') throw new Error(`unexpected table ${table}`)
      return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: opts.waiver ?? null }) }) }) }) }) }
    },
  } as never
}

const openTournament = { id: 't1', status: 'registration_open', registration_fee: 500, max_players: 8, invitation_only: false, rules: 'Be nice' }

describe('buildRegistrationState', () => {
  it('returns null when the tournament does not exist', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: null }), fakeAdmin(), 't1', 'u1')
    expect(result).toBeNull()
  })

  it('reports guest with no waiver/coin-discount detail for a logged-out visitor', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament }), fakeAdmin(), 't1', null)
    expect(result).toEqual({ view: 'guest', feeNaira: 500, hasWaiver: false, coinDiscountEligible: false, agreementRequired: true })
  })

  it('reports can_register with coin-discount eligible when fee >= 500 and no waiver', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament }), fakeAdmin(), 't1', 'u1')
    expect(result).toEqual({ view: 'can_register', feeNaira: 500, hasWaiver: false, coinDiscountEligible: true, agreementRequired: true })
  })

  it('reports hasWaiver:true and coinDiscountEligible:false when an unredeemed waiver exists', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament }), fakeAdmin({ waiver: { id: 'w1' } }), 't1', 'u1')
    expect(result).toEqual({ view: 'can_register', feeNaira: 500, hasWaiver: true, coinDiscountEligible: false, agreementRequired: true })
  })

  it('is not coin-discount eligible under the 500-naira floor', async () => {
    const cheap = { ...openTournament, registration_fee: 300 }
    const result = await buildRegistrationState(fakeSupabase({ tournament: cheap }), fakeAdmin(), 't1', 'u1')
    expect(result?.coinDiscountEligible).toBe(false)
  })

  it('reports registered for an existing paid registration', async () => {
    const result = await buildRegistrationState(
      fakeSupabase({ tournament: openTournament, existing: { id: 'r1', payment_status: 'paid', status: 'active' } }),
      fakeAdmin(), 't1', 'u1',
    )
    expect(result?.view).toBe('registered')
  })

  it('reports closed once registration has closed, distinct from full', async () => {
    const closed = { ...openTournament, status: 'registration_closed' }
    const result = await buildRegistrationState(fakeSupabase({ tournament: closed }), fakeAdmin(), 't1', 'u1')
    expect(result?.view).toBe('closed')
  })

  it('reports full (not closed) when capacity is reached while registration is still open', async () => {
    const result = await buildRegistrationState(fakeSupabase({ tournament: openTournament, paidCount: 8 }), fakeAdmin(), 't1', 'u1')
    expect(result?.view).toBe('full')
  })

  it('sets agreementRequired false when the tournament has no rules text', async () => {
    const noRules = { ...openTournament, rules: null }
    const result = await buildRegistrationState(fakeSupabase({ tournament: noRules }), fakeAdmin(), 't1', 'u1')
    expect(result?.agreementRequired).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/registration-state-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tournaments/registration-state-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveRegistrationView, type RegView } from './view'

type Admin = ReturnType<typeof createAdminClient>

export interface RegistrationState {
  view: RegView
  feeNaira: number
  hasWaiver: boolean
  coinDiscountEligible: boolean
  agreementRequired: boolean
}

// New composition (spec S5.2) — not extracted from one existing function.
// The view-state machine IS extracted, from resolveRegistrationView(); the
// waiver lookup and coin-discount eligibility are genuinely new, composed
// alongside it here.
export async function buildRegistrationState(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  tournamentId: string,
  userId: string | null,
): Promise<RegistrationState | null> {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, registration_fee, max_players, invitation_only, rules')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return null

  let paidCount = 0
  let existingStatus: string | null = null
  let registrationStatus: string | null = null
  let hasWaiver = false

  if (userId) {
    const { count } = await supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('payment_status', 'paid')
    paidCount = count ?? 0

    const { data: existing } = await supabase
      .from('tournament_registrations')
      .select('id, payment_status, status')
      .eq('tournament_id', tournamentId)
      .eq('player_id', userId)
      .maybeSingle()
    existingStatus = existing?.payment_status ?? null
    registrationStatus = existing?.status ?? null

    const { data: waiver } = await admin
      .from('tournament_fee_waivers')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('player_id', userId)
      .is('redeemed_at', null)
      .maybeSingle()
    hasWaiver = !!waiver
  }

  const view = resolveRegistrationView({
    status: tournament.status,
    loggedIn: userId !== null,
    paidCount,
    maxPlayers: tournament.max_players,
    existingStatus,
    registrationStatus,
    invitationOnly: tournament.invitation_only,
  })

  return {
    view,
    feeNaira: tournament.registration_fee,
    hasWaiver,
    coinDiscountEligible: tournament.registration_fee >= 500 && !hasWaiver,
    agreementRequired: !!tournament.rules,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/registration-state-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the endpoint**

`auth: 'public'` means `ctx` can be `null` (a logged-out visitor) — but `buildRegistrationState` still needs *some* Supabase client for the tournament read even then, since the web page shows tournament details while logged out. Use an anon client when `ctx` is null:

```typescript
// lib/mobile-api/endpoints/tournaments.ts
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildRegistrationState } from '@/lib/tournaments/registration-state-service'

const registrationStateResponse = z.object({
  view: z.enum(['guest', 'can_register', 'complete_payment', 'registered', 'waitlisted', 'full', 'closed', 'ended', 'invitation_only']),
  feeNaira: z.number(),
  hasWaiver: z.boolean(),
  coinDiscountEligible: z.boolean(),
  agreementRequired: z.boolean(),
})

export const registrationStateEndpoint = defineEndpoint({
  operationId: 'getTournamentRegistrationState',
  method: 'GET',
  path: '/tournaments/{id}/registration-state',
  summary: 'Registration view-state, fee, waiver and coin-discount eligibility for one tournament, for the caller (or a logged-out guest).',
  auth: 'public',
  response: registrationStateResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const admin = ctx?.admin ?? createAdminClient()
    const state = await buildRegistrationState(supabase, admin, params.id, ctx?.userId ?? null)
    if (!state) throw Errors.notFound()
    return state
  },
})
```

- [ ] **Step 6: Add a contract test**

```typescript
// lib/mobile-api/endpoints/tournaments.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { buildRegistrationState } = vi.hoisted(() => ({ buildRegistrationState: vi.fn() }))
vi.mock('@/lib/tournaments/registration-state-service', () => ({ buildRegistrationState }))

import { registrationStateEndpoint } from './tournaments'

describe('registrationStateEndpoint', () => {
  it('returns the built state for a known tournament', async () => {
    optionalAuth.mockResolvedValue(null)
    buildRegistrationState.mockResolvedValue({ view: 'guest', feeNaira: 500, hasWaiver: false, coinDiscountEligible: false, agreementRequired: true })
    const res = await registrationStateEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/registration-state'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.view).toBe('guest')
  })

  it('returns 404 when buildRegistrationState reports no tournament', async () => {
    optionalAuth.mockResolvedValue(null)
    buildRegistrationState.mockResolvedValue(null)
    const res = await registrationStateEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/missing/registration-state'),
      { params: { id: 'missing' } },
    )
    expect(res.status).toBe(404)
  })
})
```

Run: `npx vitest run lib/mobile-api/endpoints/tournaments.test.ts`
Expected: PASS.

- [ ] **Step 7: Wire the route and registry**

```typescript
// app/api/mobile/v1/tournaments/[id]/registration-state/route.ts
import { registrationStateEndpoint } from '@/lib/mobile-api/endpoints/tournaments'

export const GET = registrationStateEndpoint.handler
```

Add `registrationStateEndpoint` to `lib/mobile-api/endpoints/index.ts`'s imports and `ALL_ENDPOINTS` array.

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add lib/tournaments/registration-state-service.ts lib/tournaments/registration-state-service.test.ts lib/mobile-api/endpoints/tournaments.ts lib/mobile-api/endpoints/tournaments.test.ts "app/api/mobile/v1/tournaments/[id]/registration-state/route.ts" lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /tournaments/{id}/registration-state"
```

---

### Task 7: `POST /tournaments/{id}/register`

The largest extraction in this phase — `registerForTournament()` is 311 lines
with four completion branches (waiver / zero-fee / coin-discount-to-zero /
Paystack). This task preserves every branch faithfully, including the
web-only squad handling, and is the most important task to get right: it is
the one place real money moves.

**Files:**
- Create: `lib/tournaments/register-service.ts`
- Create: `lib/tournaments/register-service.test.ts`
- Modify: `lib/tournaments/actions.ts` (thin wrapper)
- Modify: `lib/tournaments/actions.test.ts` (must stay green, unmodified in intent — only mechanical changes if the mocked module set changes)
- Modify: `lib/mobile-api/endpoints/tournaments.ts` (add `registerEndpoint`)
- Modify: `lib/mobile-api/endpoints/tournaments.test.ts`
- Create: `app/api/mobile/v1/tournaments/[id]/register/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `checkCanRegister` (`./guard`), `getCoinBalance`/`recordCoinTransaction` (`@/lib/coins/service`), `NAIRA_PER_COIN` (`@/lib/coins/value`), `settleReferralForPaidEntry` (`@/lib/referrals/credit`), `finalizeSquadJoin` (`./squad-membership`), `assertNotPendingDeletion` (`@/lib/settings/restriction`), `initializeTransaction`/`buildReference` (`@/lib/paystack/server`), `SITE_URL` (`@/lib/seo/site`) — all reused unmodified.
- Produces: `performRegisterForTournament(supabase, admin, userId, tournamentId, input: {displayName, whatsapp, clubName, ignTag: string | null, agreedToRules: boolean, coinsUsed: number, squadId: string | null}) => Promise<RegisterResult>` where:

```typescript
export type RegisterErrorCode =
  | 'needs_username' | 'tournament_not_found' | 'rules_agreement_required'
  | 'already_registered' | 'tournament_full' | 'invitation_only' | 'registration_closed'
  | 'squads_not_available' | 'squad_not_found' | 'squad_not_accepting_members' | 'squad_full'
  | 'insufficient_coins' | 'registration_failed' | 'payment_init_failed'

export type RegisterResult =
  | { ok: false; errorCode: RegisterErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }
```

Used directly by Task 9 (invitations reuse `checkCanRegister`'s pattern, not this function — no dependency between them).

- [ ] **Step 1: Write the failing tests, covering every outcome**

```typescript
// lib/tournaments/register-service.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry: vi.fn() }))
vi.mock('./squad-membership', () => ({ finalizeSquadJoin: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn().mockResolvedValue(null) }))

import { performRegisterForTournament } from './register-service'

const baseInput = { displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC Test', ignTag: null, agreedToRules: true, coinsUsed: 0, squadId: null }

function fakeSupabase(opts: {
  profile?: { username: string | null }
  tournament?: Record<string, unknown> | null
  paidCount?: number
  existing?: { id: string; payment_status: string } | null
  squad?: Record<string, unknown> | null
  squadMemberCount?: number
}) {
  return {
    from: (table: string) => {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? { username: 'ada' } }) }) }) }
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament === undefined ? defaultTournament : opts.tournament }) }) }) }
      if (table === 'tournament_registrations') {
        return {
          select: (_cols: string, meta?: { count?: string; head?: boolean }) => {
            if (meta?.count) return { eq: () => ({ eq: () => Promise.resolve({ count: opts.paidCount ?? 0 }) }) }
            return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }
          },
        }
      }
      if (table === 'squads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.squad ?? null }) }) }) }
      if (table === 'squad_members') return { select: () => ({ eq: () => Promise.resolve({ count: opts.squadMemberCount ?? 0 }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

const defaultTournament = { id: 't1', slug: 'test-cup', status: 'registration_open', max_players: 8, rules: 'Be nice', registration_fee: 500, invitation_only: false, entry_unit: 'solo', squad_size: null }

function fakeAdmin(opts: {
  waiver?: { id: string } | null
  redeemedRows?: number
  insertError?: boolean
  updateOk?: boolean
} = {}) {
  const insert = vi.fn(() => ({ select: () => ({ single: async () => opts.insertError ? { error: { message: 'boom' }, data: null } : { data: { id: 'reg1' }, error: null } }) }))
  const update = vi.fn(() => ({ eq: () => ({ is: () => ({ select: async () => ({ data: opts.redeemedRows === 0 ? [] : [{ id: opts.waiver?.id ?? 'w1' }] }) }) }) }))
  const plainUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
  return {
    from: (table: string) => {
      if (table === 'tournament_fee_waivers') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: opts.waiver ?? null }) }) }) }) }), update }
      if (table === 'tournament_registrations') return { insert, update: plainUpdate }
      throw new Error(`unexpected admin table ${table}`)
    },
  } as never
}

describe('performRegisterForTournament', () => {
  it('needs_username when the caller has no claimed username', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ profile: { username: null } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'needs_username' })
  })

  it('tournament_not_found for an unknown tournament', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: null }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'tournament_not_found' })
  })

  it('rules_agreement_required when rules exist and agreedToRules is false', async () => {
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, agreedToRules: false })
    expect(result).toEqual({ ok: false, errorCode: 'rules_agreement_required' })
  })

  it('already_registered when a paid registration exists', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ existing: { id: 'r1', payment_status: 'paid' } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'already_registered' })
  })

  it('tournament_full when paid count meets capacity', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ paidCount: 8 }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'tournament_full' })
  })

  it('invitation_only rejects the public form', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, invitation_only: true } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'invitation_only' })
  })

  it('registration_closed when status is not registration_open', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, status: 'registration_closed' } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'registration_closed' })
  })

  it('squads_not_available when a non-solo tournament receives a squadId (mobile path guard mirrored at the service too, defense in depth)', async () => {
    const soloTournament = { ...defaultTournament }
    const result = await performRegisterForTournament(fakeSupabase({ tournament: soloTournament }), fakeAdmin(), 'u1', 't1', { ...baseInput, squadId: 'sq1' })
    expect(result).toEqual({ ok: false, errorCode: 'squads_not_available' })
  })

  it('confirms immediately via a waiver, redeeming it exactly once', async () => {
    const admin = fakeAdmin({ waiver: { id: 'w1' } })
    const result = await performRegisterForTournament(fakeSupabase({}), admin, 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'test-cup' })
  })

  it('reports registration_failed when the waiver was already redeemed by a raced request', async () => {
    const admin = fakeAdmin({ waiver: { id: 'w1' }, redeemedRows: 0 })
    const result = await performRegisterForTournament(fakeSupabase({}), admin, 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'registration_failed' })
  })

  it('confirms immediately for a zero-fee tournament with no waiver', async () => {
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, registration_fee: 0 } }), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'test-cup' })
  })

  it('rejects a coin discount when the balance is insufficient', async () => {
    const { getCoinBalance } = await import('@/lib/coins/service')
    vi.mocked(getCoinBalance).mockResolvedValue(100)
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, coinsUsed: 1000 })
    expect(result).toEqual({ ok: false, errorCode: 'insufficient_coins' })
  })

  it('confirms immediately when a full coin discount brings the fee to zero', async () => {
    const { getCoinBalance, recordCoinTransaction } = await import('@/lib/coins/service')
    vi.mocked(getCoinBalance).mockResolvedValue(2000)
    vi.mocked(recordCoinTransaction).mockResolvedValue(1000)
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, coinsUsed: 1000 })
    expect(result).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'test-cup' })
    expect(recordCoinTransaction).toHaveBeenCalledWith(expect.anything(), 'u1', -1000, 'entry_discount', 't1', expect.any(String))
  })

  it('ignores an out-of-range coinsUsed on a sub-500 tournament rather than erroring (mirrors original behavior: the UI never offers the radio there)', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const result = await performRegisterForTournament(fakeSupabase({ tournament: { ...defaultTournament, registration_fee: 300 } }), fakeAdmin(), 'u1', 't1', { ...baseInput, coinsUsed: 500 })
    expect(recordCoinTransaction).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, status: 'pending' })
  })

  it('initializes a Paystack transaction and returns pending for a full-price registration', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-abc')
    vi.mocked(initializeTransaction).mockResolvedValue('https://paystack.test/pay/ref-abc')
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: true, status: 'pending', authorizationUrl: 'https://paystack.test/pay/ref-abc', reference: 'ref-abc', tournamentSlug: 'test-cup' })
  })

  it('reports payment_init_failed without leaking the Paystack error detail', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-abc')
    vi.mocked(initializeTransaction).mockRejectedValue(new Error('paystack secret key invalid'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await performRegisterForTournament(fakeSupabase({}), fakeAdmin(), 'u1', 't1', baseInput)
    expect(result).toEqual({ ok: false, errorCode: 'payment_init_failed' })
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/register-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tournaments/register-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { checkCanRegister } from './guard'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { NAIRA_PER_COIN } from '@/lib/coins/value'
import { settleReferralForPaidEntry } from '@/lib/referrals/credit'
import { finalizeSquadJoin } from './squad-membership'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { SITE_URL } from '@/lib/seo/site'

type Admin = ReturnType<typeof createAdminClient>

export type RegisterErrorCode =
  | 'needs_username' | 'tournament_not_found' | 'rules_agreement_required'
  | 'already_registered' | 'tournament_full' | 'invitation_only' | 'registration_closed'
  | 'squads_not_available' | 'squad_not_found' | 'squad_not_accepting_members' | 'squad_full'
  | 'insufficient_coins' | 'registration_failed' | 'payment_init_failed'

export type RegisterInput = {
  displayName: string
  whatsapp: string
  clubName: string
  ignTag: string | null
  agreedToRules: boolean
  coinsUsed: number
  squadId: string | null
}

export type RegisterResult =
  | { ok: false; errorCode: RegisterErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }

// Extracted from lib/tournaments/actions.ts's registerForTournament() — the
// Server Action and POST /tournaments/{id}/register both call this. The
// Server Action still owns turning a 'confirmed'/'pending' result into its
// own redirect() — this function never redirects, it only returns.
export async function performRegisterForTournament(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  tournamentId: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  const restricted = await assertNotPendingDeletion(admin, userId)
  if (restricted) return { ok: false, errorCode: 'registration_failed' }

  const { data: callerProfile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!callerProfile?.username) return { ok: false, errorCode: 'needs_username' }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, slug, status, max_players, rules, registration_fee, invitation_only, entry_unit, squad_size')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tournament) return { ok: false, errorCode: 'tournament_not_found' }

  if (tournament.rules && !input.agreedToRules) return { ok: false, errorCode: 'rules_agreement_required' }

  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')

  const { data: existing } = await supabase
    .from('tournament_registrations')
    .select('id, payment_status')
    .eq('tournament_id', tournamentId)
    .eq('player_id', userId)
    .maybeSingle()

  const guard = checkCanRegister({
    status: tournament.status,
    paidCount: paidCount ?? 0,
    maxPlayers: tournament.max_players,
    existingStatus: existing?.payment_status ?? null,
    invitationOnly: tournament.invitation_only,
  })
  if (!guard.ok) {
    const map: Record<typeof guard.reason, RegisterErrorCode> = {
      already_registered: 'already_registered', full: 'tournament_full',
      invitation_only: 'invitation_only', not_open: 'registration_closed',
    }
    return { ok: false, errorCode: map[guard.reason] }
  }

  const squadId = input.squadId && tournament.entry_unit === 'squad' ? input.squadId : null
  if (input.squadId && !squadId) return { ok: false, errorCode: 'squads_not_available' }
  if (squadId) {
    const { data: squad } = await supabase.from('squads').select('id, tournament_id, status').eq('id', squadId).maybeSingle()
    if (!squad || squad.tournament_id !== tournamentId) return { ok: false, errorCode: 'squad_not_found' }
    if (squad.status !== 'forming') return { ok: false, errorCode: 'squad_not_accepting_members' }
    const { count: squadMemberCount } = await supabase.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', squadId)
    if ((squadMemberCount ?? 0) >= (tournament.squad_size ?? 0)) return { ok: false, errorCode: 'squad_full' }
  }

  const regFields = {
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp,
    reg_club_name: input.clubName, reg_ign_tag: input.ignTag || null,
  }

  const { data: waiver } = await admin
    .from('tournament_fee_waivers')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', userId)
    .is('redeemed_at', null)
    .maybeSingle()

  if (waiver) {
    const { data: redeemed } = await admin
      .from('tournament_fee_waivers')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('id', waiver.id)
      .is('redeemed_at', null)
      .select('id')
    if (!redeemed || redeemed.length === 0) return { ok: false, errorCode: 'registration_failed' }

    const freeRegRow = { tournament_id: tournamentId, player_id: userId, payment_status: 'paid', fee_waived: true, paystack_reference: null, joining_squad_id: squadId, ...regFields }
    let waiverRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { ok: false, errorCode: 'registration_failed' }
      waiverRegId = inserted.id
    } else {
      await admin.from('tournament_registrations').update({ payment_status: 'paid', fee_waived: true, paystack_reference: null, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
    }
    if (squadId && waiverRegId) await finalizeSquadJoin(admin, waiverRegId)
    return { ok: true, status: 'confirmed', tournamentSlug: tournament.slug }
  }

  if (tournament.registration_fee === 0) {
    const freeRegRow = { tournament_id: tournamentId, player_id: userId, payment_status: 'paid', fee_waived: false, paystack_reference: null, joining_squad_id: squadId, ...regFields }
    let zeroFeeRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { ok: false, errorCode: 'registration_failed' }
      zeroFeeRegId = inserted.id
    } else {
      await admin.from('tournament_registrations').update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
    }
    if (squadId && zeroFeeRegId) await finalizeSquadJoin(admin, zeroFeeRegId)
    return { ok: true, status: 'confirmed', tournamentSlug: tournament.slug }
  }

  let coinDiscountNaira = 0
  if (input.coinsUsed > 0 && tournament.registration_fee >= 500) {
    const balance = await getCoinBalance(admin, userId)
    if (balance < input.coinsUsed) return { ok: false, errorCode: 'insufficient_coins' }
    coinDiscountNaira = Math.round(input.coinsUsed * NAIRA_PER_COIN)
    await recordCoinTransaction(admin, userId, -input.coinsUsed, 'entry_discount', tournamentId, `Tournament entry discount — ${tournament.slug}`)
  }
  const netFee = tournament.registration_fee - coinDiscountNaira

  if (netFee <= 0) {
    const freeRegRow = { tournament_id: tournamentId, player_id: userId, payment_status: 'paid', fee_waived: false, paystack_reference: null, coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields }
    let coinFreeRegId = existing?.id
    if (!existing) {
      const { data: inserted, error: insertErr } = await admin.from('tournament_registrations').insert(freeRegRow).select('id').single()
      if (insertErr || !inserted) return { ok: false, errorCode: 'registration_failed' }
      coinFreeRegId = inserted.id
    } else {
      await admin.from('tournament_registrations').update({ payment_status: 'paid', fee_waived: false, paystack_reference: null, coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
    }
    await settleReferralForPaidEntry(admin, userId, { registrationFee: tournament.registration_fee, feeWaived: false })
    if (squadId && coinFreeRegId) await finalizeSquadJoin(admin, coinFreeRegId)
    return { ok: true, status: 'confirmed', tournamentSlug: tournament.slug }
  }

  const reference = buildReference(tournamentId, userId)
  if (!existing) {
    const { error: insertErr } = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId, player_id: userId, payment_status: 'pending', paystack_reference: reference,
      coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields,
    })
    if (insertErr) return { ok: false, errorCode: 'registration_failed' }
  } else {
    await admin.from('tournament_registrations').update({ paystack_reference: reference, coins_used: input.coinsUsed, coin_discount_naira: coinDiscountNaira, joining_squad_id: squadId, ...regFields }).eq('id', existing.id)
  }

  // Need the caller's email for Paystack — read it from auth via the RLS
  // client's own session (same source registerForTournament used: user.email!).
  const { data: authData } = await supabase.auth.getUser()
  try {
    const authorizationUrl = await initializeTransaction({
      email: authData.user!.email!,
      amountKobo: netFee * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: tournamentId, player_id: userId, slug: tournament.slug },
    })
    return { ok: true, status: 'pending', authorizationUrl, reference, tournamentSlug: tournament.slug }
  } catch (err) {
    console.error('[performRegisterForTournament] Paystack initialize failed', {
      tournamentId, reference, message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, errorCode: 'payment_init_failed' }
  }
}
```

**Note on `authData.user!.email!`:** the original action already had `user` in scope from its own earlier `supabase.auth.getUser()` call at the very top (for the username/restriction checks) and reused it here. This extraction calls `supabase.auth.getUser()` a second time instead of threading the user object through every step — an intentional, minor behavioral difference (one extra auth call) justified by keeping the function's parameter list clean (`userId` in, not a whole user object) and matching how `performClaimUsername` and other already-extracted services in this codebase take `userId: string`, not a `User` object. Add a code comment saying exactly this at the call site above.

- [ ] **Step 4: Fix the test file's fake to match the real query builder shapes used above**

The `fakeAdmin`/`fakeSupabase` helpers in Step 1 were written to the ORIGINAL action's exact chained-call shapes (`.insert().select().single()`, `.update().eq().is().select()`, etc.) — before running the tests, cross-check every chain in Step 1's fakes against the actual calls in Step 3's implementation line by line and fix any mismatch (e.g., the fake's `tournament_registrations.insert` mock must support `.select('id').single()`, not `.select('id')` alone). This mechanical alignment pass is required because the fakes were drafted from memory of the original code, not copy-pasted from Step 3's real implementation.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/register-service.test.ts`
Expected: PASS, all 17 tests.

- [ ] **Step 6: Refactor the Server Action to call the new service, confirm `actions.test.ts` stays green**

`lib/tournaments/actions.ts`'s `registerForTournament` becomes: parse `formData` with `registrationDetailsSchema`/`coinsUsedSchema` exactly as before (unchanged), get `user` via `createClient().auth.getUser()` (unchanged, still needed for the `needsUsername`-adjacent gate check message and to pass `user.id` as `userId`), call `performRegisterForTournament(createClient(), createAdminClient(), user.id, tournamentId, {displayName: parsed.data.displayName, whatsapp: parsed.data.whatsapp, clubName: parsed.data.clubName, ignTag: parsed.data.ignTag || null, agreedToRules: formData.get('agreedToRules') === 'true', coinsUsed, squadId: squadIdRaw || null})`, then map the result: `needs_username` → `{error: 'Claim a username before registering.', needsUsername: true}`; every other error code → its exact original message string (`tournament_not_found` → `'Tournament not found.'`, `rules_agreement_required` → `'Please confirm you have read and agree to the rules.'`, `already_registered` → `"You're already registered for this tournament."`, `tournament_full` → `'This tournament is full.'`, `invitation_only` → `'This tournament is invitation-only. Check your dashboard for an invite.'`, `registration_closed` → `'Registration is closed for this tournament.'`, `squads_not_available` → `'This tournament does not use squads.'`, `squad_not_found` → `'That squad no longer exists for this tournament.'`, `squad_not_accepting_members` → `'That squad is no longer accepting members.'`, `squad_full` → `'That squad is already full.'`, `insufficient_coins` → `'Not enough SX Coins for this discount.'`, `registration_failed` → `'Could not complete registration. Please try again.'`, `payment_init_failed` → `'Payment could not be started. Please try again.'`); on `ok: true, status: 'confirmed'` → `redirect(\`/tournaments/${result.tournamentSlug}?paid=1\`)`; on `ok: true, status: 'pending'` → `redirect(result.authorizationUrl)`.

Run: `npx vitest run lib/tournaments/actions.test.ts`
Expected: PASS, unmodified — this is the regression check that the extraction didn't change web behavior. If it fails, the mismatch is in the wrapper's mapping, not in a test that needs updating; fix the wrapper.

- [ ] **Step 7: Add the endpoint**

Append to `lib/mobile-api/endpoints/tournaments.ts`:

```typescript
import { performRegisterForTournament, type RegisterErrorCode } from '@/lib/tournaments/register-service'

const registerBody = z.object({
  displayName: z.string().trim().min(1).max(60),
  whatsapp: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  clubName: z.string().trim().min(1).max(60),
  ignTag: z.string().trim().max(60).optional(),
  agreedToRules: z.boolean(),
  coinsUsed: z.number().int().nonnegative().default(0),
  squadId: z.string().optional(),
})

const registerResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmed') }),
  z.object({ status: z.literal('pending'), authorizationUrl: z.string(), reference: z.string() }),
])

const REGISTER_ERROR_STATUS: Record<RegisterErrorCode, number> = {
  needs_username: 400, tournament_not_found: 404, rules_agreement_required: 400,
  already_registered: 409, tournament_full: 409, invitation_only: 403, registration_closed: 409,
  squads_not_available: 400, squad_not_found: 404, squad_not_accepting_members: 409, squad_full: 409,
  insufficient_coins: 400, registration_failed: 500, payment_init_failed: 502,
}
const REGISTER_ERROR_MESSAGE: Record<RegisterErrorCode, string> = {
  needs_username: 'Claim a username before registering.',
  tournament_not_found: 'Tournament not found.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_registered: "You're already registered for this tournament.",
  tournament_full: 'This tournament is full.',
  invitation_only: 'This tournament is invitation-only. Check your dashboard for an invite.',
  registration_closed: 'Registration is closed for this tournament.',
  squads_not_available: 'Squad registration is not available in the app yet.',
  squad_not_found: 'That squad no longer exists for this tournament.',
  squad_not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
  insufficient_coins: 'Not enough SX Coins for this discount.',
  registration_failed: 'Could not complete registration. Please try again.',
  payment_init_failed: 'Payment could not be started. Please try again.',
}

export const registerEndpoint = defineEndpoint({
  operationId: 'postTournamentRegister',
  method: 'POST',
  path: '/tournaments/{id}/register',
  summary: 'Register for a tournament — waiver, zero-fee, coin-discount-to-zero, or Paystack, in that precedence.',
  auth: 'user',
  idempotent: true,
  body: registerBody,
  response: registerResponse,
  handler: async ({ ctx, body, params }) => {
    if (body.squadId) throw new ApiError(400, 'squads_not_available', REGISTER_ERROR_MESSAGE.squads_not_available)
    const result = await performRegisterForTournament(ctx.userClient, ctx.admin, ctx.userId, params.id, {
      displayName: body.displayName, whatsapp: body.whatsapp, clubName: body.clubName,
      ignTag: body.ignTag ?? null, agreedToRules: body.agreedToRules, coinsUsed: body.coinsUsed,
      squadId: null,
    })
    if (!result.ok) throw new ApiError(REGISTER_ERROR_STATUS[result.errorCode], result.errorCode, REGISTER_ERROR_MESSAGE[result.errorCode])
    if (result.status === 'confirmed') return { status: 'confirmed' as const }
    return { status: 'pending' as const, authorizationUrl: result.authorizationUrl, reference: result.reference }
  },
})
```

Add `import { ApiError } from '../errors'` to the top of `tournaments.ts` if not already present from Task 6.

- [ ] **Step 8: Add contract tests**

```typescript
describe('registerEndpoint', () => {
  it('rejects a non-null squadId at the route level before calling the service', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC', agreedToRules: true, coinsUsed: 0, squadId: 'sq1' }),
    })
    const res = await registerEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('squads_not_available')
    expect(performRegisterForTournament).not.toHaveBeenCalled()
  })
})
```

(Mock `@/lib/tournaments/register-service` at the top of `tournaments.test.ts` alongside the existing `registration-state-service` mock, matching the file's established `vi.hoisted`/`vi.mock` pattern from Task 6 Step 6.)

Run: `npx vitest run lib/mobile-api/endpoints/tournaments.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the route and registry**

```typescript
// app/api/mobile/v1/tournaments/[id]/register/route.ts
import { registerEndpoint } from '@/lib/mobile-api/endpoints/tournaments'

export const POST = registerEndpoint.handler
```

Add `registerEndpoint` to `lib/mobile-api/endpoints/index.ts`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/tournaments/register-service.ts lib/tournaments/register-service.test.ts lib/tournaments/actions.ts lib/mobile-api/endpoints/tournaments.ts lib/mobile-api/endpoints/tournaments.test.ts "app/api/mobile/v1/tournaments/[id]/register/route.ts" lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /tournaments/{id}/register"
```

---

### Task 8: `POST /tournaments/{id}/waitlist`

**Files:**
- Create: `lib/tournaments/waitlist-service.ts`
- Create: `lib/tournaments/waitlist-service.test.ts`
- Modify: `lib/tournaments/waitlist-actions.ts` (thin wrapper)
- Modify: `lib/tournaments/waitlist-actions.test.ts` (must stay green)
- Modify: `lib/mobile-api/endpoints/tournaments.ts` (add `waitlistEndpoint`)
- Modify: `lib/mobile-api/endpoints/tournaments.test.ts`
- Create: `app/api/mobile/v1/tournaments/[id]/waitlist/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `assertNotPendingDeletion` (`@/lib/settings/restriction`) — same reused import as Task 7.
- Produces: `performJoinWaitlist(supabase, admin, userId, tournamentId, input: {displayName, whatsapp, clubName, ignTag: string | null, agreedToRules: boolean}) => Promise<WaitlistResult>`:

```typescript
export type WaitlistErrorCode =
  | 'needs_username' | 'tournament_not_found' | 'waitlist_not_open'
  | 'rules_agreement_required' | 'already_on_waitlist' | 'already_registered' | 'waitlist_failed'
export type WaitlistResult = { ok: false; errorCode: WaitlistErrorCode } | { ok: true }
```

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/waitlist-service.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn().mockResolvedValue(null) }))
import { performJoinWaitlist } from './waitlist-service'

const baseInput = { displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC Test', ignTag: null, agreedToRules: true }

function fakeSupabase(opts: { profile?: { username: string | null }; tournament?: Record<string, unknown> | null; existing?: { id: string; status: string } | null }) {
  return {
    from: (table: string) => {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? { username: 'ada' } }) }) }) }
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament === undefined ? { id: 't1', slug: 'cup', status: 'registration_closed', rules: 'Be nice' } : opts.tournament }) }) }) }
      if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

function fakeAdmin(opts: { insertError?: boolean } = {}) {
  return { from: () => ({ insert: async () => ({ error: opts.insertError ? { message: 'boom' } : null }) }) } as never
}

describe('performJoinWaitlist', () => {
  it('needs_username without a claimed username', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ profile: { username: null } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'needs_username' })
  })
  it('tournament_not_found for an unknown tournament', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ tournament: null }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'tournament_not_found' })
  })
  it('waitlist_not_open while status is still registration_open', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ tournament: { id: 't1', slug: 'cup', status: 'registration_open', rules: null } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'waitlist_not_open' })
  })
  it('rules_agreement_required when rules exist and agreedToRules is false', async () => {
    expect(await performJoinWaitlist(fakeSupabase({}), fakeAdmin(), 'u1', 't1', { ...baseInput, agreedToRules: false })).toEqual({ ok: false, errorCode: 'rules_agreement_required' })
  })
  it('already_on_waitlist when an existing waitlisted row exists', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ existing: { id: 'r1', status: 'waitlisted' } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'already_on_waitlist' })
  })
  it('already_registered when an existing non-waitlisted row exists', async () => {
    expect(await performJoinWaitlist(fakeSupabase({ existing: { id: 'r1', status: 'active' } }), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'already_registered' })
  })
  it('succeeds and inserts a waitlisted row', async () => {
    expect(await performJoinWaitlist(fakeSupabase({}), fakeAdmin(), 'u1', 't1', baseInput)).toEqual({ ok: true })
  })
  it('waitlist_failed when the insert errors', async () => {
    expect(await performJoinWaitlist(fakeSupabase({}), fakeAdmin({ insertError: true }), 'u1', 't1', baseInput)).toEqual({ ok: false, errorCode: 'waitlist_failed' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/waitlist-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tournaments/waitlist-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

type Admin = ReturnType<typeof createAdminClient>

export type WaitlistErrorCode =
  | 'needs_username' | 'tournament_not_found' | 'waitlist_not_open'
  | 'rules_agreement_required' | 'already_on_waitlist' | 'already_registered' | 'waitlist_failed'

export type WaitlistInput = { displayName: string; whatsapp: string; clubName: string; ignTag: string | null; agreedToRules: boolean }
export type WaitlistResult = { ok: false; errorCode: WaitlistErrorCode } | { ok: true }

// Extracted from lib/tournaments/waitlist-actions.ts's joinWaitlist().
export async function performJoinWaitlist(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  tournamentId: string,
  input: WaitlistInput,
): Promise<WaitlistResult> {
  const restricted = await assertNotPendingDeletion(admin, userId)
  if (restricted) return { ok: false, errorCode: 'waitlist_failed' }

  const { data: callerProfile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!callerProfile?.username) return { ok: false, errorCode: 'needs_username' }

  const { data: tournament } = await supabase.from('tournaments').select('id, slug, status, rules').eq('id', tournamentId).maybeSingle()
  if (!tournament) return { ok: false, errorCode: 'tournament_not_found' }
  if (tournament.status !== 'registration_closed' && tournament.status !== 'active') return { ok: false, errorCode: 'waitlist_not_open' }
  if (tournament.rules && !input.agreedToRules) return { ok: false, errorCode: 'rules_agreement_required' }

  const { data: existing } = await supabase.from('tournament_registrations').select('id, status').eq('tournament_id', tournamentId).eq('player_id', userId).maybeSingle()
  if (existing) return { ok: false, errorCode: existing.status === 'waitlisted' ? 'already_on_waitlist' : 'already_registered' }

  const { error: insErr } = await admin.from('tournament_registrations').insert({
    tournament_id: tournamentId, player_id: userId, payment_status: 'pending', status: 'waitlisted',
    reg_display_name: input.displayName, reg_whatsapp: input.whatsapp, reg_club_name: input.clubName, reg_ign_tag: input.ignTag || null,
  })
  if (insErr) return { ok: false, errorCode: 'waitlist_failed' }

  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/waitlist-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action, confirm `waitlist-actions.test.ts` stays green**

`joinWaitlist` becomes a thin wrapper: parse formData with `registrationDetailsSchema` (unchanged), get `user`, call `performJoinWaitlist(createClient(), createAdminClient(), user.id, tournamentId, {...parsed.data, ignTag: parsed.data.ignTag || null, agreedToRules: formData.get('agreedToRules') === 'true'})`, map results back to the original `JoinWaitlistState` shape (`needs_username` → `{error: 'Claim a username before joining the waitlist.', needsUsername: true}`; `tournament_not_found` → `{error: 'Tournament not found.'}`; `waitlist_not_open` → `{error: 'The waitlist is only open once registration has closed.'}`; `rules_agreement_required` → `{error: 'Please confirm you have read and agree to the rules.'}`; `already_on_waitlist` → `{error: "You're already on the waitlist."}`; `already_registered` → `{error: "You're already registered for this tournament."}`; `waitlist_failed` → `{error: 'Could not join the waitlist. Please try again.'}`; `ok: true` → keep the existing `revalidatePath` calls, then `{success: true}`).

Run: `npx vitest run lib/tournaments/waitlist-actions.test.ts`
Expected: PASS, unmodified.

- [ ] **Step 6: Add the endpoint**

Append to `lib/mobile-api/endpoints/tournaments.ts`:

```typescript
import { performJoinWaitlist, type WaitlistErrorCode } from '@/lib/tournaments/waitlist-service'

const waitlistBody = z.object({
  displayName: z.string().trim().min(1).max(60),
  whatsapp: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  clubName: z.string().trim().min(1).max(60),
  ignTag: z.string().trim().max(60).optional(),
  agreedToRules: z.boolean(),
})
const waitlistResponse = z.object({ status: z.literal('waitlisted') })

const WAITLIST_ERROR_STATUS: Record<WaitlistErrorCode, number> = {
  needs_username: 400, tournament_not_found: 404, waitlist_not_open: 409,
  rules_agreement_required: 400, already_on_waitlist: 409, already_registered: 409, waitlist_failed: 500,
}
const WAITLIST_ERROR_MESSAGE: Record<WaitlistErrorCode, string> = {
  needs_username: 'Claim a username before joining the waitlist.',
  tournament_not_found: 'Tournament not found.',
  waitlist_not_open: 'The waitlist is only open once registration has closed.',
  rules_agreement_required: 'Please confirm you have read and agree to the rules.',
  already_on_waitlist: "You're already on the waitlist.",
  already_registered: "You're already registered for this tournament.",
  waitlist_failed: 'Could not join the waitlist. Please try again.',
}

export const waitlistEndpoint = defineEndpoint({
  operationId: 'postTournamentWaitlist',
  method: 'POST',
  path: '/tournaments/{id}/waitlist',
  summary: 'Join the waitlist once registration has closed — no payment step.',
  auth: 'user',
  body: waitlistBody,
  response: waitlistResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performJoinWaitlist(ctx.userClient, ctx.admin, ctx.userId, params.id, {
      displayName: body.displayName, whatsapp: body.whatsapp, clubName: body.clubName,
      ignTag: body.ignTag ?? null, agreedToRules: body.agreedToRules,
    })
    if (!result.ok) throw new ApiError(WAITLIST_ERROR_STATUS[result.errorCode], result.errorCode, WAITLIST_ERROR_MESSAGE[result.errorCode])
    return { status: 'waitlisted' as const }
  },
})
```

- [ ] **Step 7: Add a contract test, mirroring Task 6 Step 6's pattern (mock `performJoinWaitlist`, assert one success and one error-mapping case)**

```typescript
describe('waitlistEndpoint', () => {
  it('maps waitlist_not_open to 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    const { performJoinWaitlist } = await import('@/lib/tournaments/waitlist-service')
    vi.mocked(performJoinWaitlist).mockResolvedValue({ ok: false, errorCode: 'waitlist_not_open' })
    const req = new Request('https://x.test/api/mobile/v1/tournaments/t1/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', whatsapp: '+2348012345678', clubName: 'FC', agreedToRules: true }),
    })
    const res = await waitlistEndpoint.handler(req, { params: { id: 't1' } })
    expect(res.status).toBe(409)
  })
})
```

Add `vi.mock('@/lib/tournaments/waitlist-service', () => ({ performJoinWaitlist: vi.fn() }))` at the top of `tournaments.test.ts`.

Run: `npx vitest run lib/mobile-api/endpoints/tournaments.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the route and registry**

```typescript
// app/api/mobile/v1/tournaments/[id]/waitlist/route.ts
import { waitlistEndpoint } from '@/lib/mobile-api/endpoints/tournaments'

export const POST = waitlistEndpoint.handler
```

Add `waitlistEndpoint` to `lib/mobile-api/endpoints/index.ts`.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/tournaments/waitlist-service.ts lib/tournaments/waitlist-service.test.ts lib/tournaments/waitlist-actions.ts lib/mobile-api/endpoints/tournaments.ts lib/mobile-api/endpoints/tournaments.test.ts "app/api/mobile/v1/tournaments/[id]/waitlist/route.ts" lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /tournaments/{id}/waitlist"
```

---

### Task 9: `POST /invitations/{id}/accept` and `POST /invitations/{id}/decline`

**Files:**
- Create: `lib/seasons/invitation-response-service.ts`
- Create: `lib/seasons/invitation-response-service.test.ts`
- Modify: `lib/seasons/player-actions.ts` (thin wrappers)
- Create: `lib/mobile-api/endpoints/invitations.ts`
- Create: `lib/mobile-api/endpoints/invitations.test.ts`
- Create: `app/api/mobile/v1/invitations/[id]/accept/route.ts`
- Create: `app/api/mobile/v1/invitations/[id]/decline/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `cascadeNextInvitation` (`./invitation-actions`), `initializeTransaction`/`buildReference` (`@/lib/paystack/server`), `SITE_URL` (`@/lib/seo/site`) — reused unmodified.
- Produces:

```typescript
export type AcceptInvitationErrorCode = 'invitation_not_found' | 'invitation_no_longer_available' | 'invitation_expired' | 'payment_init_failed'
export type AcceptInvitationResult =
  | { ok: false; errorCode: AcceptInvitationErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }

export type DeclineInvitationErrorCode = 'invitation_not_found'
export type DeclineInvitationResult = { ok: false; errorCode: DeclineInvitationErrorCode } | { ok: true }
```

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/seasons/invitation-response-service.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('./invitation-actions', () => ({ cascadeNextInvitation: vi.fn() }))
import { performAcceptInvitation, performDeclineInvitation } from './invitation-response-service'

function fakeAdmin(opts: {
  invitation?: Record<string, unknown> | null
  claimedRows?: number
  insertError?: boolean
} = {}) {
  const defaultInvitation = {
    id: 'inv1', player_id: 'u1', status: 'pending', expires_at: new Date(Date.now() + 86_400_000).toISOString(), tournament_id: 't1',
    tournament: { id: 't1', slug: 'masters', title: 'Masters Cup', registration_fee: 500 },
  }
  return {
    from: (table: string) => {
      if (table === 'tournament_invitations') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.invitation === undefined ? defaultInvitation : opts.invitation }) }) }),
          update: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: opts.claimedRows === 0 ? [] : [{ id: 'inv1', tournament_id: 't1' }] }) }) }) }),
        }
      }
      if (table === 'tournament_registrations') return { insert: async () => ({ error: opts.insertError ? { message: 'boom' } : null }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

describe('performAcceptInvitation', () => {
  it('invitation_not_found for a missing or not-mine invitation', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ invitation: null }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_not_found' })
    expect(await performAcceptInvitation(fakeAdmin({ invitation: { id: 'inv1', player_id: 'someone-else', status: 'pending', expires_at: new Date(Date.now() + 1000).toISOString(), tournament_id: 't1', tournament: {} } }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_not_found' })
  })
  it('invitation_no_longer_available when status is not pending', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ invitation: { id: 'inv1', player_id: 'u1', status: 'declined', expires_at: new Date(Date.now() + 1000).toISOString(), tournament_id: 't1', tournament: {} } }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_no_longer_available' })
  })
  it('invitation_expired when past expires_at', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ invitation: { id: 'inv1', player_id: 'u1', status: 'pending', expires_at: new Date(Date.now() - 1000).toISOString(), tournament_id: 't1', tournament: {} } }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_expired' })
  })
  it('invitation_no_longer_available when a raced claim finds zero rows', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ claimedRows: 0 }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_no_longer_available' })
  })
  it('confirms immediately for a free tournament', async () => {
    const admin = fakeAdmin({ invitation: { id: 'inv1', player_id: 'u1', status: 'pending', expires_at: new Date(Date.now() + 1000).toISOString(), tournament_id: 't1', tournament: { id: 't1', slug: 'masters', title: 'Masters Cup', registration_fee: 0 } } })
    expect(await performAcceptInvitation(admin, 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'masters' })
  })
  it('initializes Paystack and returns pending for a paid tournament', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-1')
    vi.mocked(initializeTransaction).mockResolvedValue('https://paystack.test/pay/ref-1')
    expect(await performAcceptInvitation(fakeAdmin(), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: true, status: 'pending', authorizationUrl: 'https://paystack.test/pay/ref-1', reference: 'ref-1', tournamentSlug: 'masters' })
  })
  it('payment_init_failed without leaking the Paystack error', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-1')
    vi.mocked(initializeTransaction).mockRejectedValue(new Error('secret detail'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await performAcceptInvitation(fakeAdmin(), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'payment_init_failed' })
    spy.mockRestore()
  })
})

describe('performDeclineInvitation', () => {
  it('invitation_not_found when the claim finds zero rows', async () => {
    expect(await performDeclineInvitation(fakeAdmin({ claimedRows: 0 }), 'u1')).toEqual({ ok: false, errorCode: 'invitation_not_found' })
  })
  it('succeeds and cascades to the next invitee', async () => {
    const { cascadeNextInvitation } = await import('./invitation-actions')
    expect(await performDeclineInvitation(fakeAdmin(), 'u1')).toEqual({ ok: true })
    expect(cascadeNextInvitation).toHaveBeenCalledWith(expect.anything(), 't1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/seasons/invitation-response-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/seasons/invitation-response-service.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { cascadeNextInvitation } from './invitation-actions'
import { initializeTransaction, buildReference } from '@/lib/paystack/server'
import { SITE_URL } from '@/lib/seo/site'

type Admin = ReturnType<typeof createAdminClient>

export type AcceptInvitationErrorCode = 'invitation_not_found' | 'invitation_no_longer_available' | 'invitation_expired' | 'payment_init_failed'
export type AcceptInvitationResult =
  | { ok: false; errorCode: AcceptInvitationErrorCode }
  | { ok: true; status: 'confirmed'; tournamentSlug: string }
  | { ok: true; status: 'pending'; authorizationUrl: string; reference: string; tournamentSlug: string }

interface TournamentInfo { id: string; slug: string; title: string; registration_fee: number }

// Extracted from lib/seasons/player-actions.ts's acceptMastersInvitation().
// email is required because initializeTransaction() needs it and it isn't
// derivable from tournament_invitations/tournament_registrations — it comes
// from auth.users, which the caller already has in scope (ctx.email in the
// endpoint, user.email in the Server Action wrapper).
export async function performAcceptInvitation(
  admin: Admin,
  userId: string,
  invitationId: string,
  email: string,
): Promise<AcceptInvitationResult> {
  const { data: invitation } = await admin
    .from('tournament_invitations')
    .select('id, player_id, status, expires_at, tournament_id, tournament:tournaments(id, slug, title, registration_fee)')
    .eq('id', invitationId)
    .maybeSingle()
  if (!invitation || invitation.player_id !== userId) return { ok: false, errorCode: 'invitation_not_found' }
  if (invitation.status !== 'pending') return { ok: false, errorCode: 'invitation_no_longer_available' }
  if (new Date(invitation.expires_at as string) < new Date()) return { ok: false, errorCode: 'invitation_expired' }

  const tRaw = invitation.tournament as TournamentInfo | TournamentInfo[] | null
  const t = Array.isArray(tRaw) ? tRaw[0] : tRaw
  if (!t) return { ok: false, errorCode: 'invitation_not_found' }

  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select('id')
  if (!claimed || claimed.length === 0) return { ok: false, errorCode: 'invitation_no_longer_available' }

  const isFree = t.registration_fee <= 0
  const reference = isFree ? null : buildReference(t.id, userId)

  await admin.from('tournament_registrations').insert({
    tournament_id: t.id, player_id: userId, status: 'active',
    payment_status: isFree ? 'paid' : 'pending', paystack_reference: reference,
  })

  if (isFree) return { ok: true, status: 'confirmed', tournamentSlug: t.slug }

  try {
    const authorizationUrl = await initializeTransaction({
      email,
      amountKobo: t.registration_fee * 100,
      reference: reference!,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { tournament_id: t.id, player_id: userId, slug: t.slug },
    })
    return { ok: true, status: 'pending', authorizationUrl, reference: reference!, tournamentSlug: t.slug }
  } catch (err) {
    console.error('[performAcceptInvitation] Paystack initialize failed', { tournamentId: t.id, reference, message: err instanceof Error ? err.message : String(err) })
    return { ok: false, errorCode: 'payment_init_failed' }
  }
}

export type DeclineInvitationErrorCode = 'invitation_not_found'
export type DeclineInvitationResult = { ok: false; errorCode: DeclineInvitationErrorCode } | { ok: true }

// Extracted from lib/seasons/player-actions.ts's declineMastersInvitation().
export async function performDeclineInvitation(admin: Admin, userId: string, invitationId: string): Promise<DeclineInvitationResult> {
  const { data: claimed } = await admin
    .from('tournament_invitations')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('player_id', userId)
    .eq('status', 'pending')
    .select('id, tournament_id')
  if (!claimed || claimed.length === 0) return { ok: false, errorCode: 'invitation_not_found' }
  await cascadeNextInvitation(admin, claimed[0].tournament_id)
  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/seasons/invitation-response-service.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Refactor the Server Actions, confirm no existing test regresses**

`find lib/seasons -iname "*player-actions*test*"` first (confirmed absent during spec research) — nothing to keep green, but still refactor `acceptMastersInvitation`/`declineMastersInvitation` in `lib/seasons/player-actions.ts` into thin wrappers calling `performAcceptInvitation(createAdminClient(), user.id, invitationId, user.email!)` / `performDeclineInvitation(createAdminClient(), user.id, invitationId)`, mapping results to the original `InvitationResponseState` shape and `redirect()`/`revalidatePath` calls exactly as `registerForTournament`'s wrapper does in Task 7 Step 6.

- [ ] **Step 6: Add the endpoints**

```typescript
// lib/mobile-api/endpoints/invitations.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performAcceptInvitation, performDeclineInvitation, type AcceptInvitationErrorCode, type DeclineInvitationErrorCode } from '@/lib/seasons/invitation-response-service'

const acceptResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmed') }),
  z.object({ status: z.literal('pending'), authorizationUrl: z.string(), reference: z.string() }),
])

const ACCEPT_ERROR_STATUS: Record<AcceptInvitationErrorCode, number> = {
  invitation_not_found: 404, invitation_no_longer_available: 409, invitation_expired: 410, payment_init_failed: 502,
}
const ACCEPT_ERROR_MESSAGE: Record<AcceptInvitationErrorCode, string> = {
  invitation_not_found: 'Invitation not found.',
  invitation_no_longer_available: 'This invitation is no longer available.',
  invitation_expired: 'This invitation has expired.',
  payment_init_failed: 'Payment could not be started. Your spot is reserved — try again from your dashboard.',
}

export const acceptInvitationEndpoint = defineEndpoint({
  operationId: 'postInvitationAccept',
  method: 'POST',
  path: '/invitations/{id}/accept',
  summary: 'Accept a season invitation — confirms immediately if free, else opens a Paystack transaction.',
  auth: 'user',
  idempotent: true,
  response: acceptResponse,
  handler: async ({ ctx, params }) => {
    const result = await performAcceptInvitation(ctx.admin, ctx.userId, params.id, ctx.email ?? '')
    if (!result.ok) throw new ApiError(ACCEPT_ERROR_STATUS[result.errorCode], result.errorCode, ACCEPT_ERROR_MESSAGE[result.errorCode])
    if (result.status === 'confirmed') return { status: 'confirmed' as const }
    return { status: 'pending' as const, authorizationUrl: result.authorizationUrl, reference: result.reference }
  },
})

const declineResponse = z.object({ status: z.literal('declined') })
const DECLINE_ERROR_STATUS: Record<DeclineInvitationErrorCode, number> = { invitation_not_found: 404 }

export const declineInvitationEndpoint = defineEndpoint({
  operationId: 'postInvitationDecline',
  method: 'POST',
  path: '/invitations/{id}/decline',
  summary: 'Decline a season invitation — cascades to the next invitee.',
  auth: 'user',
  response: declineResponse,
  handler: async ({ ctx, params }) => {
    const result = await performDeclineInvitation(ctx.admin, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(DECLINE_ERROR_STATUS[result.errorCode], result.errorCode, 'Invitation not found.')
    return { status: 'declined' as const }
  },
})
```

`ctx.email` requires `MobileCtx` to expose an `email` field — check `lib/mobile-api/auth.ts` (already read during spec research: `MobileCtx` already has `email: string | null` from Phase 0B). No change needed there; `ctx.email ?? ''` guards the rare case of a Google-only account with no email on the Supabase user record.

- [ ] **Step 7: Add contract tests**

Mirror Task 8 Step 7's pattern: mock `@/lib/seasons/invitation-response-service`, write one success-path test and one error-mapping test for each endpoint (four tests total) in `lib/mobile-api/endpoints/invitations.test.ts`.

Run: `npx vitest run lib/mobile-api/endpoints/invitations.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the routes and registry**

```typescript
// app/api/mobile/v1/invitations/[id]/accept/route.ts
import { acceptInvitationEndpoint } from '@/lib/mobile-api/endpoints/invitations'
export const POST = acceptInvitationEndpoint.handler
```

```typescript
// app/api/mobile/v1/invitations/[id]/decline/route.ts
import { declineInvitationEndpoint } from '@/lib/mobile-api/endpoints/invitations'
export const POST = declineInvitationEndpoint.handler
```

Add both endpoints to `lib/mobile-api/endpoints/index.ts`.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/seasons/invitation-response-service.ts lib/seasons/invitation-response-service.test.ts lib/seasons/player-actions.ts lib/mobile-api/endpoints/invitations.ts lib/mobile-api/endpoints/invitations.test.ts "app/api/mobile/v1/invitations/[id]/accept/route.ts" "app/api/mobile/v1/invitations/[id]/decline/route.ts" lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /invitations/{id}/accept and /decline"
```

---

### Task 10: `GET /payments/{reference}`

A thin wrap, not an extraction — `confirmRegistration()` is already a plain,
idempotent function called by both the Paystack webhook and the browser
callback today.

**Files:**
- Create: `lib/mobile-api/endpoints/payments.ts`
- Create: `lib/mobile-api/endpoints/payments.test.ts`
- Create: `app/api/mobile/v1/payments/[reference]/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `confirmRegistration(reference: string) => Promise<'confirmed' | 'already_paid' | 'not_found' | 'not_successful'>` from `@/lib/tournaments/confirm` — reused completely unmodified, no extraction needed.
- Produces: `GET /payments/{reference}` → `{ status: 'confirmed' | 'already_paid' | 'not_found' | 'not_successful' }`.

- [ ] **Step 1: Write the endpoint directly (no service extraction step — there's nothing to extract)**

```typescript
// lib/mobile-api/endpoints/payments.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { confirmRegistration } from '@/lib/tournaments/confirm'

const paymentStatusResponse = z.object({
  status: z.enum(['confirmed', 'already_paid', 'not_found', 'not_successful']),
})

export const paymentStatusEndpoint = defineEndpoint({
  operationId: 'getPaymentStatus',
  method: 'GET',
  path: '/payments/{reference}',
  summary: 'Poll a Paystack registration payment\'s confirmation status. The webhook remains the source of truth; this is UI polling only.',
  auth: 'user',
  response: paymentStatusResponse,
  handler: async ({ params }) => {
    const status = await confirmRegistration(params.reference)
    return { status }
  },
})
```

- [ ] **Step 2: Write the contract test**

```typescript
// lib/mobile-api/endpoints/payments.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { confirmRegistration } = vi.hoisted(() => ({ confirmRegistration: vi.fn() }))
vi.mock('@/lib/tournaments/confirm', () => ({ confirmRegistration }))

import { paymentStatusEndpoint } from './payments'

describe('paymentStatusEndpoint', () => {
  it('passes the path param reference straight through to confirmRegistration and returns its status', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    confirmRegistration.mockResolvedValue('confirmed')
    const res = await paymentStatusEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/payments/ref-abc'),
      { params: { reference: 'ref-abc' } },
    )
    expect(confirmRegistration).toHaveBeenCalledWith('ref-abc')
    expect(await res.json()).toEqual({ data: { status: 'confirmed' } })
  })
})
```

Run: `npx vitest run lib/mobile-api/endpoints/payments.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire the route and registry**

```typescript
// app/api/mobile/v1/payments/[reference]/route.ts
import { paymentStatusEndpoint } from '@/lib/mobile-api/endpoints/payments'

export const GET = paymentStatusEndpoint.handler
```

Add `paymentStatusEndpoint` to `lib/mobile-api/endpoints/index.ts`.

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add lib/mobile-api/endpoints/payments.ts lib/mobile-api/endpoints/payments.test.ts "app/api/mobile/v1/payments/[reference]/route.ts" lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /payments/{reference}"
```

---

### Task 11: OpenAPI regeneration, staging migration re-check, full verification

**Files:**
- Modify: `openapi/mobile-v1.json` (regenerated, not hand-edited)
- Modify: `lib/mobile-api/endpoints/index.ts` (verify final state — should already be complete from Tasks 5–10)

**Interfaces:**
- Consumes: `ALL_ENDPOINTS` from `./index` (every endpoint added by Tasks 5–10 must appear here — this task is the checkpoint, not a place to add anything new).

- [ ] **Step 1: Verify every new endpoint is registered**

Open `lib/mobile-api/endpoints/index.ts` and confirm the imports and `ALL_ENDPOINTS` array include: `updateProfileEndpoint`, `registrationStateEndpoint`, `registerEndpoint`, `waitlistEndpoint`, `acceptInvitationEndpoint`, `declineInvitationEndpoint`, `paymentStatusEndpoint` — six new imports (from `./me`, `./tournaments` ×3, `./invitations` ×2, `./payments`) alongside everything already there from Phase 0B/1. If any is missing (each task's own Step should have added it, but this is the single place a miss would surface), add it now.

- [ ] **Step 2: Regenerate the OpenAPI document**

Run: `npm run openapi`

This runs `vitest run lib/mobile-api/openapi.test.ts -u`, which snapshot-updates `openapi/mobile-v1.json` from the current `ALL_ENDPOINTS`. Expected: the test passes and the file diff shows exactly the 7 new paths added (`/me/profile`, `/tournaments/{id}/registration-state`, `/tournaments/{id}/register`, `/tournaments/{id}/waitlist`, `/invitations/{id}/accept`, `/invitations/{id}/decline`, `/payments/{reference}`) plus any new schema components (`RegisterErrorCode`'s union isn't itself a named schema — the zod response/body schemas from each endpoint are), with no changes to any of the 10 pre-existing paths.

- [ ] **Step 3: Diff-review the regenerated file**

Run: `git diff openapi/mobile-v1.json`

Confirm by eye: no pre-existing path's shape changed (a change there would mean an earlier task accidentally touched shared response-schema code), every new path has the correct `security` block (`idempotent: true` doesn't itself appear in OpenAPI output — `defineEndpoint`'s `idempotent` option isn't part of `EndpointMeta`, so it never reaches `buildOpenApi()`; this is expected and correct, since `Idempotency-Key` is a header convention documented in the mobile spec, not a per-endpoint OpenAPI parameter this generator currently models — no action needed, just don't be surprised it's absent from the diff).

- [ ] **Step 4: Re-verify the staging project has every migration this plan added**

This plan added exactly one migration (`20260922210000_api_idempotency_keys.sql`, Task 1). Confirm it's still present and correctly shaped on staging — Task 1 already applied and verified it, this is a final sanity check before calling the phase done, not new work:

Run `mcp__claude_ai_Supabase__execute_sql` with `project_id: "ofxmoxpvwbemfouaowoa"` and query:
```sql
select column_name, data_type from information_schema.columns where table_name = 'api_idempotency_keys' order by ordinal_position;
```
Expected: `key text`, `user_id uuid`, `route text`, `response jsonb`, `status_code integer`, `created_at timestamp with time zone`, `completed_at timestamp with time zone`.

- [ ] **Step 5: Full verification pass**

Run, in order, and confirm every one is clean:
```bash
npx tsc --noEmit
npm run test
npm run lint
```

(`npm run lint` matters here specifically because `tsc --noEmit` passing does not guarantee `next build` passes — ESLint runs as part of `next build` too, a gotcha already hit once during Phase 0B; don't skip it.)

- [ ] **Step 6: Commit**

```bash
git add openapi/mobile-v1.json
git commit -m "chore(mobile-api): regenerate openapi.json for the 2a endpoints"
```

- [ ] **Step 7: Update `CLAUDE.md` housekeeping, matching the pattern Phase 1's plan used**

Add one line to this repo's `CLAUDE.md` mobile-related section (or create one if none exists yet from Phase 0B/1's own housekeeping step) noting: `api_idempotency_keys` exists and its claim/fill/reclaim contract (§4 of the Phase 2a spec) is the pattern every future money-creating mobile write reuses — point at the spec file rather than re-describing the mechanism inline, so this note doesn't drift out of sync with the real implementation.

```bash
git add CLAUDE.md
git commit -m "docs: note api_idempotency_keys pattern in CLAUDE.md"
```

**This plan is complete once Task 11 is committed.** The Flutter-side screens (spec §6) are a separate plan, written in the `sentinelx_mobile` repo, once this plan's endpoints are live and `openapi/mobile-v1.json`'s new paths are pulled into that repo's pinned copy.
