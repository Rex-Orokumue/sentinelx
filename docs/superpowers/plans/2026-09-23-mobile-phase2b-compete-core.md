# Mobile Phase 2b Compete Core (web repo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/api/mobile/v1` endpoints Mobile Phase 2b (bracket/standings, Match Centre, check-in, result submission, wagering, squads, opponent rating, dashboard fixtures) depends on, in the web repo, without changing any existing web behavior.

**Architecture:** Same per-domain service-function extraction pattern 2a established (§7.1 of the master mobile spec): each existing FormData Server Action's body moves into a plain, client-injected service function; the Server Action becomes a thin wrapper calling it; a new `defineEndpoint`-based route calls the same function. Several reads (`loadBracketView`, `stageStanding`, `fetchChampions`) are already plain, composable functions — those endpoints are thin wraps, not extractions. Idempotency reuses 2a's existing `runIdempotent`/`idempotent: true` primitive as-is — no new idempotency infrastructure this phase.

**Tech Stack:** Next.js 14 API routes, zod, Supabase (`supabase-js`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-mobile-phase2b-compete-core-design.md` — read this in full before starting; this plan implements §2, §4, §5, §6, §7.

## Global Constraints

- **Never change existing web behavior.** Every extraction is a pure refactor — the Server Action's existing test file (if any) must stay green, unmodified, after its extraction task.
- **Never write via PostgREST from a mobile write path.** All T3 writes go through `ctx.admin` (service role) exactly as the existing Server Actions already do — never `ctx.userClient` for a write.
- **Squad member remove/move are explicitly OUT of scope** (spec §5 correction) — `removeSquadMember`/`moveSquadMember` are `requireAdmin()`-gated staff tools, not built in this plan. Only `createSquad` (write) and `lookupSquadByCode` (read) are in scope.
- **`route` for idempotency purposes is the concrete request path** (`new URL(req.url).pathname`), never the route template — exactly as 2a's `defineEndpoint` already implements it. No changes needed to that mechanism.
- **Extraction file naming convention** (established in 2a): `lib/<domain>/<verb>-service.ts` exporting `perform<Verb>(...)`, an `<Verb>ErrorCode` union type, and a result type `{ok: true, ...} | {ok: false, errorCode: <Verb>ErrorCode}`. Follow this exactly — do not invent a different shape.
- **Endpoint error-code-to-HTTP-status maps live beside the endpoint definition** in `lib/mobile-api/endpoints/<domain>.ts` (e.g. `REGISTER_ERROR_STATUS` in 2a's `tournaments.ts`), not inside the service file — the service file has no knowledge of HTTP.
- Every new test file follows the hand-rolled-fake convention already established in this repo (see `lib/onboarding/claim-username-service.test.ts`, or 2a's `lib/tournaments/registration-state-service.test.ts`) — no new mocking library.
- **Endpoint-level tests call `endpoint.handler(request, {params})` — the full `Request`-in/`Response`-out wrapper.** `defineEndpoint` returns `{ meta, handler }` only (confirmed directly: `lib/mobile-api/define-endpoint.ts:136`) — there is no `def` property. The established pattern (`lib/mobile-api/endpoints/tournaments.test.ts`, 2a), used by every endpoint test in this plan: `vi.hoisted` + `vi.mock('../auth', () => ({ authenticate, optionalAuth }))` at the top of the file, then per test set `authenticate.mockResolvedValue({userId, admin, userClient, ...})` (`auth: 'user'`) or `optionalAuth.mockResolvedValue(...)` (`auth: 'public'`), build a real `new Request(url, {method, headers, body: JSON.stringify(...)})`, call `await endpoint.handler(req, {params: {id: '...'}})`, then assert on `res.status` and `(await res.json()).data`/`.error.code`. `idempotent: true` endpoints additionally mock `runIdempotent` from `../idempotency` (pass-through: `mockImplementation(async (_admin, _args, run) => run())`) and send an `idempotency-key` header.
- Run `npx tsc --noEmit` and `npm run test` before every commit that touches more than a test file; both must be clean.
- **`sx_score_events.event_type` already permits `'rating_received'`** (confirmed directly against `supabase/migrations/008_win_no_dispute_event.sql`'s CHECK constraint — the value was added years ago and never used). No migration is needed for Task 10 (opponent rating).

---

### Task 1: Vercel preview environment scoped to `sentinelx-staging`

**Files:** none in this repo — this task is Vercel project configuration via the Vercel MCP tools, plus one verification step. No commit.

**Interfaces:** none (infrastructure only; nothing downstream depends on a specific interface, only on the environment being correctly wired before Task 2 onward run any write-path testing against it).

- [ ] **Step 1: Add branch-scoped preview env vars pointed at `sentinelx-staging`**

Using `mcp__claude_ai_Vercel__create_project_env` (or the equivalent "edit" tool if an entry for the key already exists at `[preview, production]` scope — check with `filter_project_envs` first, described in the design spec's §2 investigation), add these four, each scoped to `target: ["preview"]` **and** `gitBranch: "<this plan's implementation branch name>"** (the branch this plan's tasks commit to — confirm the exact branch name with whichever workflow started this plan, e.g. `subagent-driven-development`'s worktree branch):

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://ofxmoxpvwbemfouaowoa.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ofxmoxpvwbemfouaowoa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | fetch via `mcp__claude_ai_Supabase__get_publishable_keys`/project settings for `ofxmoxpvwbemfouaowoa` — the **service role** secret, not the anon/publishable key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon/publishable key for `ofxmoxpvwbemfouaowoa` |

**Paystack test-mode keys are owner-supplied, not generated here** — pause and ask the person running this plan for `PAYSTACK_SECRET_KEY` (test mode, `sk_test_...`) and `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (`pk_test_...`) from the Paystack dashboard before continuing this step. Add both the same way, same branch scope.

- [ ] **Step 2: Trigger a preview deployment and verify it resolves to staging**

Push any commit on this plan's branch (even an empty one is fine if nothing has changed yet — e.g. `git commit --allow-empty -m "chore: trigger preview deploy for staging env check"`) to get a preview build, or use `mcp__claude_ai_Vercel__create_deployment` directly against this branch.

Once deployed, hit the preview URL's `/api/mobile/v1/config` endpoint (already built, Phase 0B) and confirm the response doesn't error — then, more decisively, check the preview deployment's runtime logs (`mcp__claude_ai_Vercel__get_runtime_logs` or `get_deployment`) for any Supabase connection during that request, and confirm the project ref in those logs is `ofxmoxpvwbemfouaowoa`, not `itxubrkbropttfdackmi`. If a log-based check isn't conclusive, instead add a temporary `console.log(process.env.SUPABASE_URL)` at the very top of `app/api/mobile/v1/config/route.ts`'s handler, redeploy, hit it once, read the log line, then remove the temporary log line and redeploy again before Task 2 starts — never leave debug logging like this in the codebase past this verification step.

- [ ] **Step 3: Record the confirmed branch name**

Note the exact branch name that now carries the staging-scoped env vars somewhere visible to the rest of this plan's execution (e.g. the subagent-driven-development tracking issue/task list) — every subsequent task's manual staging verification (if any) depends on testing against **this** branch's preview deployments, not any other branch's.

No commit for this task (Vercel config only; Step 2's empty commit, if used, needs no message beyond what's shown).

---

### Task 2: `GET /tournaments/{id}/bracket`

**Files:**
- Create: `lib/mobile-api/endpoints/bracket.ts`
- Create: `lib/mobile-api/endpoints/bracket.test.ts`
- Create: `app/api/mobile/v1/tournaments/[id]/bracket/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `loadBracketView(supabase, tournamentId, format)` from `@/lib/tournaments/bracket-view` — reused unmodified, a thin wrap, not an extraction (confirmed: already a plain, composable async function called identically by both the public and admin bracket pages).
- Produces: `bracketEndpoint: Endpoint`, registered in `ALL_ENDPOINTS`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/mobile-api/endpoints/bracket.test.ts
import { describe, it, expect, vi } from 'vitest'

const { optionalAuth } = vi.hoisted(() => ({ optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth }))
const { loadBracketView } = vi.hoisted(() => ({ loadBracketView: vi.fn() }))
vi.mock('@/lib/tournaments/bracket-view', () => ({ loadBracketView }))

import { bracketEndpoint } from './bracket'

const view = {
  standings: [{ groupId: 'g1', groupName: 'Group A', rows: [] }],
  fixtures: { live: [], upcoming: [], completed: [], disputedOrCancelled: [] },
  rounds: [],
  projected: [{ round: 'final', label: 'Final', matchCount: 1 }],
  champion: null,
  thirdPlace: null,
  thirdPlaceMatch: null,
  hasGroups: true,
  hasKnockout: true,
}

describe('bracketEndpoint', () => {
  it('404s when the tournament does not exist', async () => {
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
    optionalAuth.mockResolvedValue({ userClient: supabase, userId: null })
    const res = await bracketEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/bracket'), { params: { id: 't1' } })
    expect(res.status).toBe(404)
  })

  it('loads the tournament format then calls loadBracketView', async () => {
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { format: 'groups_knockout' } }) }) }) }) }
    optionalAuth.mockResolvedValue({ userClient: supabase, userId: null })
    loadBracketView.mockResolvedValue(view)
    const res = await bracketEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/bracket'), { params: { id: 't1' } })
    expect(loadBracketView).toHaveBeenCalledWith(supabase, 't1', 'groups_knockout')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(view)
  })
})
```

Note: check the real `MobileCtx` shape returned by `optionalAuth` in `lib/mobile-api/auth.ts` before finalizing this test — the fake `{userClient, userId: null}` object above is a minimal stand-in; if `optionalAuth`'s real non-null return always includes every `MobileCtx` field (not just the two the handler reads), match that shape exactly rather than the trimmed version shown, the same way `tournaments.test.ts`'s own `authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })` only includes the fields that specific handler reads — follow that established file's precedent for how much of the shape a mock needs to include.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mobile-api/endpoints/bracket.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the endpoint**

```typescript
// lib/mobile-api/endpoints/bracket.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { loadBracketView } from '@/lib/tournaments/bracket-view'

const standingRow = z.object({
  playerId: z.string(), name: z.string(), clubName: z.string().nullable().optional(),
  played: z.number(), wins: z.number(), draws: z.number(), losses: z.number(),
  goalsFor: z.number(), goalsAgainst: z.number(), goalDiff: z.number(), points: z.number(),
  rank: z.number(), advancing: z.boolean(),
})
const bracketMatch = z.object({
  id: z.string(), round: z.string(), group_id: z.string().nullable(), groupName: z.string().nullable(),
  status: z.string(), score_a: z.number().nullable(), score_b: z.number().nullable(),
  scheduled_at: z.string().nullable(), is_full_day: z.boolean(),
  playerA: z.object({ id: z.string(), name: z.string() }),
  playerB: z.object({ id: z.string(), name: z.string() }),
})
const fixtureSplit = z.object({
  live: z.array(bracketMatch), upcoming: z.array(bracketMatch),
  completed: z.array(bracketMatch), disputedOrCancelled: z.array(bracketMatch),
})
const knockoutRound = z.object({ round: z.string(), label: z.string(), matches: z.array(bracketMatch) })
const projectedRound = z.object({ round: z.string(), label: z.string(), matchCount: z.number() })
const nameRef = z.object({ id: z.string(), name: z.string() }).nullable()

const bracketResponse = z.object({
  standings: z.array(z.object({ groupId: z.string(), groupName: z.string(), rows: z.array(standingRow) })),
  fixtures: fixtureSplit,
  rounds: z.array(knockoutRound),
  projected: z.array(projectedRound),
  champion: nameRef,
  thirdPlace: nameRef,
  thirdPlaceMatch: bracketMatch.nullable(),
  hasGroups: z.boolean(),
  hasKnockout: z.boolean(),
})

export const bracketEndpoint = defineEndpoint({
  operationId: 'getTournamentBracket',
  method: 'GET',
  path: '/tournaments/{id}/bracket',
  summary: 'Group standings, fixtures, and knockout rounds for one tournament.',
  auth: 'public',
  response: bracketResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { data: t } = await supabase.from('tournaments').select('format').eq('id', params.id).maybeSingle()
    if (!t) throw Errors.notFound()
    return loadBracketView(supabase, params.id, t.format)
  },
})
```

`auth: 'public'` matches the public bracket page's own access (no login required to view a published bracket). `ctx` can be fully `null` for a logged-out guest (`optionalAuth`'s return type, per the Global Constraints note above) — `ctx?.userClient ?? createAnonClient()` matches `registrationStateEndpoint`'s own established pattern for a public GET (`lib/mobile-api/endpoints/tournaments.ts`). Add the import: `import { createAnonClient } from '../anon-client'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/bracket.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the route and registry**

`app/api/mobile/v1/tournaments/[id]/bracket/route.ts`:

```typescript
import { bracketEndpoint } from '@/lib/mobile-api/endpoints/bracket'

export const GET = bracketEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add `import { bracketEndpoint } from './bracket'` and append `bracketEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/mobile-api/endpoints/bracket.ts lib/mobile-api/endpoints/bracket.test.ts app/api/mobile/v1/tournaments/[id]/bracket/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /tournaments/{id}/bracket"
```

---

### Task 3: `GET /tournaments/{id}/standings?stage=`

**Files:**
- Create: `lib/mobile-api/endpoints/standings.ts`
- Create: `lib/mobile-api/endpoints/standings.test.ts`
- Create: `app/api/mobile/v1/tournaments/[id]/standings/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `stageStanding(admin, stage: {id, advance_count})` from `@/lib/tournaments/stage-standing` — reused unmodified, already a full DB-composing async function, thin wrap only.
- Produces: `standingsEndpoint: Endpoint`.

**Scope note carried from the design spec:** this endpoint only serves points-race/round-robin **stages** (`tournament_stages` rows — the `?stage=` query param is a stage id). Group-format (head-to-head) tournaments already expose their standings inside `GET /tournaments/{id}/bracket`'s `.standings` field (Task 2) — do not build a second, duplicate composition for that case here.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/mobile-api/endpoints/standings.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
const { stageStanding } = vi.hoisted(() => ({ stageStanding: vi.fn() }))
vi.mock('@/lib/tournaments/stage-standing', () => ({ stageStanding }))
const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { standingsEndpoint } from './standings'

describe('standingsEndpoint', () => {
  it('requires a stage query param', async () => {
    const res = await standingsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/standings'), { params: { id: 't1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation_failed')
  })

  it('404s when the stage does not belong to this tournament', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }
    createAdminClient.mockReturnValue(admin)
    const res = await standingsEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/standings?stage=s1'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(404)
  })

  it('calls stageStanding for a valid stage', async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1', advance_count: 8 } }) }) }) }) }) }
    createAdminClient.mockReturnValue(admin)
    stageStanding.mockResolvedValue([{ entrantId: 'e1' }])
    const res = await standingsEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/standings?stage=s1'),
      { params: { id: 't1' } },
    )
    expect(stageStanding).toHaveBeenCalledWith(admin, { id: 's1', advance_count: 8 })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ rows: [{ entrantId: 'e1' }] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mobile-api/endpoints/standings.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the endpoint**

This is the first endpoint in the mobile API to read a query parameter (confirmed: no existing endpoint file uses `searchParams`) — `defineEndpoint` doesn't parse query strings itself, only the JSON body, so this handler reads `new URL(req.url).searchParams` directly.

Confirmed directly against `lib/mobile-api/define-endpoint.ts:84-85`: `auth: 'public'` resolves `ctx` via `optionalAuth(req)`, whose return type is `MobileCtx | null` — for a logged-out guest, `ctx` is fully `null`, not merely missing a `userId`. There is no `ctx.admin` to fall back on for a guest request, so this handler builds its own service-role client directly rather than depending on `ctx`:

```typescript
// lib/mobile-api/endpoints/standings.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { stageStanding } from '@/lib/tournaments/stage-standing'

const pointsStandingRow = z.object({
  entrantId: z.string(), displayName: z.string(), played: z.number(),
  totalPoints: z.number(), totalKills: z.number(),
  bestPlacement: z.number().nullable(), lastRoundPlacement: z.number().nullable(),
  rank: z.number(), advancing: z.boolean(), unresolvedTieWith: z.array(z.string()),
})
const standingsResponse = z.object({ rows: z.array(pointsStandingRow) })

export const standingsEndpoint = defineEndpoint({
  operationId: 'getTournamentStandings',
  method: 'GET',
  path: '/tournaments/{id}/standings',
  summary: 'Points-race stage standings (round-robin/BR). Group standings live in GET /tournaments/{id}/bracket instead.',
  auth: 'public',
  response: standingsResponse,
  handler: async ({ req, params }) => {
    const stageId = new URL(req.url).searchParams.get('stage')
    if (!stageId) throw Errors.validation({ stage: 'A stage query parameter is required.' })
    const admin = createAdminClient()
    const { data: stage } = await admin
      .from('tournament_stages')
      .select('id, advance_count, tournament_id')
      .eq('id', stageId)
      .eq('tournament_id', params.id)
      .maybeSingle()
    if (!stage) throw Errors.notFound()
    const rows = await stageStanding(admin, { id: stage.id, advance_count: stage.advance_count })
    return { rows }
  },
})
```

Update Step 1's test to match: `ctx: null` in every test case (since this handler no longer reads `ctx` at all), and mock `@/lib/supabase/admin`'s `createAdminClient` to return the fake `admin` object instead of threading it in through `ctx.admin`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/standings.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the route and registry**

`app/api/mobile/v1/tournaments/[id]/standings/route.ts`:

```typescript
import { standingsEndpoint } from '@/lib/mobile-api/endpoints/standings'

export const GET = standingsEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `standingsEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/mobile-api/endpoints/standings.ts lib/mobile-api/endpoints/standings.test.ts app/api/mobile/v1/tournaments/[id]/standings/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /tournaments/{id}/standings"
```

---

### Task 4: `GET /tournaments/{id}/results`

**Files:**
- Create: `lib/mobile-api/endpoints/results.ts`
- Create: `lib/mobile-api/endpoints/results.test.ts`
- Create: `app/api/mobile/v1/tournaments/[id]/results/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `fetchChampions(supabase, {tournamentId})` from `@/lib/tournaments/champions` and `isClosedWithoutWinner(status, finalRows)` from `@/lib/tournaments/no-winner` — both reused unmodified, thin wrap. Confirmed real usage site: `app/[locale]/(public)/tournaments/[slug]/page.tsx` lines ~167-181.
- Produces: `resultsEndpoint: Endpoint`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/mobile-api/endpoints/results.test.ts
import { describe, it, expect, vi } from 'vitest'

const { optionalAuth } = vi.hoisted(() => ({ optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth }))
const { fetchChampions } = vi.hoisted(() => ({ fetchChampions: vi.fn() }))
vi.mock('@/lib/tournaments/champions', () => ({ fetchChampions }))
const { isClosedWithoutWinner } = vi.hoisted(() => ({ isClosedWithoutWinner: vi.fn() }))
vi.mock('@/lib/tournaments/no-winner', () => ({ isClosedWithoutWinner }))

import { resultsEndpoint } from './results'

function fakeSupabase(opts: { tournament: { id: string; status: string } | null; finalRows?: { round: string; status: string }[] }) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament }) }) }) }
      if (table === 'matches') return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: opts.finalRows ?? [] }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const fakeChampion = {
  tournamentId: 't1', slug: 'sample', title: 'Sample Cup', tournamentType: 'open' as const,
  gameId: 'g1', gameName: 'DLS', date: '2026-09-01T00:00:00Z', prizePool: 50000,
  champion: { id: 'p1', name: 'Player One' }, runnerUp: { id: 'p2', name: 'Player Two' },
  championAvatarUrl: null, seasonName: null,
}

describe('resultsEndpoint', () => {
  it('404s when the tournament does not exist', async () => {
    optionalAuth.mockResolvedValue({ userClient: fakeSupabase({ tournament: null }) })
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(res.status).toBe(404)
  })

  it('returns the champion when the tournament is completed and one was resolved', async () => {
    const supabase = fakeSupabase({ tournament: { id: 't1', status: 'completed' } })
    optionalAuth.mockResolvedValue({ userClient: supabase })
    fetchChampions.mockResolvedValue([fakeChampion])
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(fetchChampions).toHaveBeenCalledWith(supabase, { tournamentId: 't1' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ champion: fakeChampion, noWinner: false })
  })

  it('reports noWinner when completed with no champion and the final was closed without one', async () => {
    const supabase = fakeSupabase({ tournament: { id: 't1', status: 'completed' }, finalRows: [{ round: 'final', status: 'disputed' }] })
    optionalAuth.mockResolvedValue({ userClient: supabase })
    fetchChampions.mockResolvedValue([])
    isClosedWithoutWinner.mockReturnValue(true)
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(isClosedWithoutWinner).toHaveBeenCalledWith('completed', [{ round: 'final', status: 'disputed' }])
    expect((await res.json()).data).toEqual({ champion: null, noWinner: true })
  })

  it('returns nulls for a tournament that has not finished', async () => {
    optionalAuth.mockResolvedValue({ userClient: fakeSupabase({ tournament: { id: 't1', status: 'active' } }) })
    const res = await resultsEndpoint.handler(new Request('https://x.test/api/mobile/v1/tournaments/t1/results'), { params: { id: 't1' } })
    expect(fetchChampions).not.toHaveBeenCalled()
    expect((await res.json()).data).toEqual({ champion: null, noWinner: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mobile-api/endpoints/results.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the endpoint**

`fetchChampions`'s real `ChampionEntry` shape (`lib/tournaments/champions.ts:127-143`), used verbatim below:

```typescript
// lib/mobile-api/endpoints/results.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { fetchChampions } from '@/lib/tournaments/champions'
import { isClosedWithoutWinner } from '@/lib/tournaments/no-winner'

const placing = z.object({ id: z.string(), name: z.string() })
const championEntry = z.object({
  tournamentId: z.string(),
  slug: z.string(),
  title: z.string(),
  tournamentType: z.enum(['champions_cup', 'masters', 'community_club', 'open']),
  gameId: z.string(),
  gameName: z.string(),
  date: z.string().nullable(),
  prizePool: z.number().nullable(),
  champion: placing,
  runnerUp: placing.nullable(),
  championAvatarUrl: z.string().nullable(),
  seasonName: z.string().nullable(),
})

const resultsResponse = z.object({
  champion: championEntry.nullable(),
  noWinner: z.boolean(),
})

export const resultsEndpoint = defineEndpoint({
  operationId: 'getTournamentResults',
  method: 'GET',
  path: '/tournaments/{id}/results',
  summary: 'Champion (if resolved) and no-winner status for a completed tournament.',
  auth: 'public',
  response: resultsResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { data: t } = await supabase.from('tournaments').select('id, status').eq('id', params.id).maybeSingle()
    if (!t) throw Errors.notFound()
    if (t.status !== 'completed') return { champion: null, noWinner: false }

    const champions = await fetchChampions(supabase, { tournamentId: t.id })
    const champion = champions[0] ?? null
    let noWinner = false
    if (!champion) {
      const { data: finalRows } = await supabase.from('matches').select('round, status').eq('tournament_id', t.id).eq('round', 'final')
      noWinner = isClosedWithoutWinner(t.status, finalRows ?? [])
    }
    return { champion, noWinner }
  },
})
```

Add the import `import { createAnonClient } from '../anon-client'`, matching Task 2's same `auth: 'public'` null-`ctx` handling.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/results.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the route and registry**

`app/api/mobile/v1/tournaments/[id]/results/route.ts`:

```typescript
import { resultsEndpoint } from '@/lib/mobile-api/endpoints/results'

export const GET = resultsEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `resultsEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/mobile-api/endpoints/results.ts lib/mobile-api/endpoints/results.test.ts app/api/mobile/v1/tournaments/[id]/results/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /tournaments/{id}/results"
```

---

### Task 5: `POST /squads`

**Files:**
- Create: `lib/tournaments/create-squad-service.ts`
- Create: `lib/tournaments/create-squad-service.test.ts`
- Modify: `lib/tournaments/squad-actions.ts` (thin wrapper)
- Create: `lib/mobile-api/endpoints/squads.ts`
- Create: `lib/mobile-api/endpoints/squads.test.ts`
- Create: `app/api/mobile/v1/squads/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `squadNameSchema` from `@/lib/tournaments/squad-schema` (reused unmodified, 2-30 chars).
- Produces: `performCreateSquad(supabase, admin, userId, {tournamentId, name}) => Promise<{ok: true, squadId: string, inviteCode: string} | {ok: false, errorCode: CreateSquadErrorCode}>`, `CreateSquadErrorCode = 'no_username' | 'tournament_not_found' | 'not_squad_tournament' | 'registration_closed' | 'already_in_squad' | 'invite_code_failed' | 'name_taken' | 'create_failed'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/create-squad-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performCreateSquad } from './create-squad-service'

vi.mock('./squad-membership', () => ({ uniqueInviteCode: vi.fn().mockResolvedValue('ABCD1234') }))

function fakeSupabase(opts: {
  profile?: { username: string | null } | null
  tournament?: { id: string; status: string; entry_unit: string } | null
  existingMembership?: { id: string } | null
}) {
  return {
    from: (table: string) => {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? null }) }) }) }
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament ?? null }) }) }) }
      if (table === 'squad_members') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existingMembership ?? null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

function fakeAdmin(opts: { insertError?: { code?: string } | null } = {}) {
  return {
    from: (table: string) => {
      if (table !== 'squads') throw new Error(`unexpected table ${table}`)
      return {
        insert: () => ({
          select: () => ({
            single: async () =>
              opts.insertError
                ? { data: null, error: opts.insertError }
                : { data: { id: 'sq1', invite_code: 'ABCD1234' }, error: null },
          }),
        }),
      }
    },
  } as never
}

const openSquadTournament = { id: 't1', status: 'registration_open', entry_unit: 'squad' }

describe('performCreateSquad', () => {
  it('rejects when the caller has no username', async () => {
    const result = await performCreateSquad(fakeSupabase({ profile: { username: null } }), fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' })
    expect(result).toEqual({ ok: false, errorCode: 'no_username' })
  })

  it('rejects a non-squad tournament', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: { id: 't1', status: 'registration_open', entry_unit: 'solo' } }),
      fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'not_squad_tournament' })
  })

  it('rejects when the caller is already in a squad for this tournament', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: openSquadTournament, existingMembership: { id: 'm1' } }),
      fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'already_in_squad' })
  })

  it('creates the squad and returns its id and invite code', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: openSquadTournament }),
      fakeAdmin(), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: true, squadId: 'sq1', inviteCode: 'ABCD1234' })
  })

  it('maps a unique-name collision to name_taken', async () => {
    const result = await performCreateSquad(
      fakeSupabase({ profile: { username: 'x' }, tournament: openSquadTournament }),
      fakeAdmin({ insertError: { code: '23505' } }), 'u1', { tournamentId: 't1', name: 'Squad A' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'name_taken' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/create-squad-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Extracted from `createSquad` in `lib/tournaments/squad-actions.ts` (read in full during spec research) — every branch preserved, `uniqueInviteCode` import unchanged:

```typescript
// lib/tournaments/create-squad-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { uniqueInviteCode } from './squad-membership'

type Admin = ReturnType<typeof createAdminClient>

export type CreateSquadErrorCode =
  | 'no_username' | 'tournament_not_found' | 'not_squad_tournament' | 'registration_closed'
  | 'already_in_squad' | 'invite_code_failed' | 'name_taken' | 'create_failed'
export type CreateSquadResult =
  | { ok: true; squadId: string; inviteCode: string }
  | { ok: false; errorCode: CreateSquadErrorCode }

export async function performCreateSquad(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  input: { tournamentId: string; name: string },
): Promise<CreateSquadResult> {
  const { data: profile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!profile?.username) return { ok: false, errorCode: 'no_username' }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, entry_unit')
    .eq('id', input.tournamentId)
    .maybeSingle()
  if (!tournament) return { ok: false, errorCode: 'tournament_not_found' }
  if (tournament.entry_unit !== 'squad') return { ok: false, errorCode: 'not_squad_tournament' }
  if (tournament.status !== 'registration_open') return { ok: false, errorCode: 'registration_closed' }

  const { data: existingMembership } = await supabase
    .from('squad_members')
    .select('id')
    .eq('tournament_id', input.tournamentId)
    .eq('player_id', userId)
    .maybeSingle()
  if (existingMembership) return { ok: false, errorCode: 'already_in_squad' }

  let inviteCode: string
  try {
    inviteCode = await uniqueInviteCode(admin)
  } catch {
    return { ok: false, errorCode: 'invite_code_failed' }
  }

  const { data: squad, error } = await admin
    .from('squads')
    .insert({ tournament_id: input.tournamentId, name: input.name, captain_id: userId, invite_code: inviteCode, status: 'forming' })
    .select('id, invite_code')
    .single()
  if (error || !squad) {
    return { ok: false, errorCode: (error as { code?: string } | null)?.code === '23505' ? 'name_taken' : 'create_failed' }
  }

  return { ok: true, squadId: squad.id, inviteCode: squad.invite_code }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/create-squad-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service**

In `lib/tournaments/squad-actions.ts`, `createSquad` becomes: parse `tournamentId`/`name` from `formData` (the `squadNameSchema.safeParse` check stays in the action — it's form validation, not business logic), require login (`createClient().auth.getUser()`), call `performCreateSquad(supabase, createAdminClient(), user.id, {tournamentId, name: parsed.data})`, map each `errorCode` to the existing friendly message (`no_username` → `'Claim a username before creating a squad.'`, `not_squad_tournament` → `'This tournament does not use squads.'`, `tournament_not_found` → `'Tournament not found.'`, `registration_closed` → `'Registration is not open.'`, `already_in_squad` → `"You're already in a squad for this tournament."`, `invite_code_failed` → whatever message `uniqueInviteCode` itself threw (re-derive by catching inside the action same as before, since the service swallows that message into a fixed code — keep the action's own try/catch around `performCreateSquad`'s call is unnecessary here since the service already catches it; instead accept the generic `'Could not create a squad. Please try again.'` for `invite_code_failed`, a message-fidelity trade-off worth flagging to the user reviewing this task's diff, not a silent regression), `name_taken` → `'A squad with that name already exists in this tournament.'`, `create_failed` → `'Could not create the squad. Please try again.'`), keep the existing `revalidatePath('/tournaments')` call after success.

Run: `find lib/tournaments -iname "squad-actions.test.ts"` first — if no such file exists, skip to Step 6.

- [ ] **Step 6: Write the endpoint's failing test**

`POST /squads` is `idempotent: true` — its test mocks `runIdempotent` the same way `tournaments.test.ts` does for `registerEndpoint` (`runIdempotent.mockImplementation(async (_admin, _args, run) => run())`, so it just executes the handler through once, and the request carries an `idempotency-key` header):

```typescript
// lib/mobile-api/endpoints/squads.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performCreateSquad } = vi.hoisted(() => ({ performCreateSquad: vi.fn() }))
vi.mock('@/lib/tournaments/create-squad-service', () => ({ performCreateSquad }))

import { createSquadEndpoint } from './squads'

function postReq(body: unknown) {
  return new Request('https://x.test/api/mobile/v1/squads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
    body: JSON.stringify(body),
  })
}

describe('createSquadEndpoint', () => {
  it('returns squadId/inviteCode on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performCreateSquad.mockResolvedValue({ ok: true, squadId: 'sq1', inviteCode: 'ABCD1234' })
    const res = await createSquadEndpoint.handler(postReq({ tournamentId: 't1', name: 'Squad A' }), { params: {} })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ squadId: 'sq1', inviteCode: 'ABCD1234' })
  })

  it('maps already_in_squad to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: {}, userClient: {} })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performCreateSquad.mockResolvedValue({ ok: false, errorCode: 'already_in_squad' })
    const res = await createSquadEndpoint.handler(postReq({ tournamentId: 't1', name: 'Squad A' }), { params: {} })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_in_squad')
  })
})
```

- [ ] **Step 7: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/squads.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/squads.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performCreateSquad, type CreateSquadErrorCode } from '@/lib/tournaments/create-squad-service'
import { squadNameSchema } from '@/lib/tournaments/squad-schema'

const createSquadBody = z.object({ tournamentId: z.string(), name: squadNameSchema })
const createSquadResponse = z.object({ squadId: z.string(), inviteCode: z.string() })

const STATUS: Record<CreateSquadErrorCode, number> = {
  no_username: 400, tournament_not_found: 404, not_squad_tournament: 400, registration_closed: 409,
  already_in_squad: 409, invite_code_failed: 500, name_taken: 409, create_failed: 500,
}
const MESSAGE: Record<CreateSquadErrorCode, string> = {
  no_username: 'Claim a username before creating a squad.',
  tournament_not_found: 'Tournament not found.',
  not_squad_tournament: 'This tournament does not use squads.',
  registration_closed: 'Registration is not open.',
  already_in_squad: "You're already in a squad for this tournament.",
  invite_code_failed: 'Could not create a squad. Please try again.',
  name_taken: 'A squad with that name already exists in this tournament.',
  create_failed: 'Could not create the squad. Please try again.',
}

export const createSquadEndpoint = defineEndpoint({
  operationId: 'postSquads',
  method: 'POST',
  path: '/squads',
  summary: 'Create a squad for a squad-entry tournament and receive its invite code.',
  auth: 'user',
  idempotent: true,
  body: createSquadBody,
  response: createSquadResponse,
  handler: async ({ ctx, body }) => {
    const result = await performCreateSquad(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { squadId: result.squadId, inviteCode: result.inviteCode }
  },
})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/squads.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the route and registry**

`app/api/mobile/v1/squads/route.ts`:

```typescript
import { createSquadEndpoint } from '@/lib/mobile-api/endpoints/squads'

export const POST = createSquadEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `createSquadEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/tournaments/create-squad-service.ts lib/tournaments/create-squad-service.test.ts lib/tournaments/squad-actions.ts lib/mobile-api/endpoints/squads.ts lib/mobile-api/endpoints/squads.test.ts app/api/mobile/v1/squads/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /squads"
```

---

### Task 6: `GET /squads/lookup`

**Files:**
- Create: `lib/tournaments/lookup-squad-service.ts`
- Create: `lib/tournaments/lookup-squad-service.test.ts`
- Modify: `lib/tournaments/squad-actions.ts` (thin wrapper for `lookupSquadByCode`)
- Modify: `lib/mobile-api/endpoints/squads.ts`
- Modify: `lib/mobile-api/endpoints/squads.test.ts`
- Create: `app/api/mobile/v1/squads/lookup/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `inviteCodeSchema` from `@/lib/tournaments/squad-schema` (reused unmodified).
- Produces: `performLookupSquad(supabase, {tournamentId, code}) => Promise<{ok: true, squad: {id, name, memberCount, teamSize}} | {ok: false, errorCode: LookupSquadErrorCode}>`, `LookupSquadErrorCode = 'tournament_not_found' | 'squad_not_found' | 'not_accepting_members' | 'squad_full'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/lookup-squad-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performLookupSquad } from './lookup-squad-service'

function fakeSupabase(opts: {
  tournament?: { squad_size: number } | null
  squad?: { id: string; name: string; tournament_id: string; status: string } | null
  memberCount?: number
}) {
  return {
    from: (table: string) => {
      if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.tournament ?? null }) }) }) }
      if (table === 'squads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.squad ?? null }) }) }) }
      if (table === 'squad_members') return { select: () => ({ eq: () => Promise.resolve({ count: opts.memberCount ?? 0 }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

describe('performLookupSquad', () => {
  it('reports tournament_not_found when the tournament has no squad_size', async () => {
    const result = await performLookupSquad(fakeSupabase({ tournament: null }), { tournamentId: 't1', code: 'ABCD1234' })
    expect(result).toEqual({ ok: false, errorCode: 'tournament_not_found' })
  })

  it('reports squad_not_found when no squad matches the code for this tournament', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't2', status: 'forming' } }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'squad_not_found' })
  })

  it('reports not_accepting_members when the squad is not forming', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't1', status: 'complete' } }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'not_accepting_members' })
  })

  it('reports squad_full when member count has reached squad_size', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't1', status: 'forming' }, memberCount: 4 }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: false, errorCode: 'squad_full' })
  })

  it('returns the squad preview when everything checks out', async () => {
    const result = await performLookupSquad(
      fakeSupabase({ tournament: { squad_size: 4 }, squad: { id: 's1', name: 'X', tournament_id: 't1', status: 'forming' }, memberCount: 2 }),
      { tournamentId: 't1', code: 'ABCD1234' },
    )
    expect(result).toEqual({ ok: true, squad: { id: 's1', name: 'X', memberCount: 2, teamSize: 4 } })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/lookup-squad-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Extracted from `lookupSquadByCode` in `lib/tournaments/squad-actions.ts`:

```typescript
// lib/tournaments/lookup-squad-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export type LookupSquadErrorCode = 'tournament_not_found' | 'squad_not_found' | 'not_accepting_members' | 'squad_full'
export type LookupSquadResult =
  | { ok: true; squad: { id: string; name: string; memberCount: number; teamSize: number } }
  | { ok: false; errorCode: LookupSquadErrorCode }

export async function performLookupSquad(
  supabase: SupabaseClient<Database>,
  input: { tournamentId: string; code: string },
): Promise<LookupSquadResult> {
  const { data: tournament } = await supabase.from('tournaments').select('squad_size').eq('id', input.tournamentId).maybeSingle()
  if (!tournament?.squad_size) return { ok: false, errorCode: 'tournament_not_found' }

  const { data: squad } = await supabase
    .from('squads')
    .select('id, name, tournament_id, status')
    .eq('invite_code', input.code)
    .maybeSingle()
  if (!squad || squad.tournament_id !== input.tournamentId) return { ok: false, errorCode: 'squad_not_found' }
  if (squad.status !== 'forming') return { ok: false, errorCode: 'not_accepting_members' }

  const { count } = await supabase.from('squad_members').select('*', { count: 'exact', head: true }).eq('squad_id', squad.id)
  if ((count ?? 0) >= tournament.squad_size) return { ok: false, errorCode: 'squad_full' }

  return { ok: true, squad: { id: squad.id, name: squad.name, memberCount: count ?? 0, teamSize: tournament.squad_size } }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/lookup-squad-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service**

In `lib/tournaments/squad-actions.ts`, `lookupSquadByCode` becomes: parse `tournamentId`/`code` from `formData` (the `inviteCodeSchema.safeParse` check stays in the action), call `performLookupSquad(createClient(), {tournamentId, code: parsed.data})`, map each `errorCode` to the existing message (`tournament_not_found` → `'Tournament not found.'`, `squad_not_found` → `'No squad found for that code.'`, `not_accepting_members` → `'That squad is no longer accepting members.'`, `squad_full` → `'That squad is already full.'`), return `{squad: result.squad}` on success. No login required — matches the existing action, which never calls `auth.getUser()`.

- [ ] **Step 6: Write the endpoint's failing test, add to the existing `squads.test.ts`**

Add near the top of `squads.test.ts` (alongside the other `vi.hoisted`/`vi.mock` calls already there from Task 5): `const { performLookupSquad } = vi.hoisted(() => ({ performLookupSquad: vi.fn() })); vi.mock('@/lib/tournaments/lookup-squad-service', () => ({ performLookupSquad }))`, and add `lookupSquadEndpoint` to the existing `import { createSquadEndpoint } from './squads'` line. Then append:

```typescript
// append to lib/mobile-api/endpoints/squads.test.ts
describe('lookupSquadEndpoint', () => {
  it('returns the squad preview on success', async () => {
    optionalAuth.mockResolvedValue(null)
    performLookupSquad.mockResolvedValue({ ok: true, squad: { id: 's1', name: 'X', memberCount: 2, teamSize: 4 } })
    const res = await lookupSquadEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/squads/lookup?tournamentId=t1&code=ABCD1234'),
      { params: {} },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ squad: { id: 's1', name: 'X', memberCount: 2, teamSize: 4 } })
  })

  it('maps squad_full to a 409', async () => {
    optionalAuth.mockResolvedValue(null)
    performLookupSquad.mockResolvedValue({ ok: false, errorCode: 'squad_full' })
    const res = await lookupSquadEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/squads/lookup?tournamentId=t1&code=ABCD1234'),
      { params: {} },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('squad_full')
  })
})
```

- [ ] **Step 7: Run to verify it fails, then add the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/squads.test.ts` — expect FAIL, `lookupSquadEndpoint` isn't exported yet.

Append to `lib/mobile-api/endpoints/squads.ts`:

```typescript
import { performLookupSquad, type LookupSquadErrorCode } from '@/lib/tournaments/lookup-squad-service'

const squadPreview = z.object({ id: z.string(), name: z.string(), memberCount: z.number(), teamSize: z.number() })
const lookupSquadResponse = z.object({ squad: squadPreview })

const LOOKUP_STATUS: Record<LookupSquadErrorCode, number> = {
  tournament_not_found: 404, squad_not_found: 404, not_accepting_members: 409, squad_full: 409,
}
const LOOKUP_MESSAGE: Record<LookupSquadErrorCode, string> = {
  tournament_not_found: 'Tournament not found.',
  squad_not_found: 'No squad found for that code.',
  not_accepting_members: 'That squad is no longer accepting members.',
  squad_full: 'That squad is already full.',
}

export const lookupSquadEndpoint = defineEndpoint({
  operationId: 'getSquadLookup',
  method: 'GET',
  path: '/squads/lookup',
  summary: 'Preview a squad by its invite code before committing to join it.',
  auth: 'public',
  response: lookupSquadResponse,
  handler: async ({ ctx, req }) => {
    const url = new URL(req.url)
    const tournamentId = url.searchParams.get('tournamentId') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const supabase = ctx?.userClient ?? createAnonClient()
    const result = await performLookupSquad(supabase, { tournamentId, code })
    if (!result.ok) throw new ApiError(LOOKUP_STATUS[result.errorCode], result.errorCode, LOOKUP_MESSAGE[result.errorCode])
    return { squad: result.squad }
  },
})
```

Add the `createAnonClient` import from `'../anon-client'` alongside the file's existing imports if not already present (check Task 5's version of this file first — it may not have needed it, since `POST /squads` is `auth: 'user'`, always has `ctx`).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/squads.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 9: Wire the route and registry**

`app/api/mobile/v1/squads/lookup/route.ts`:

```typescript
import { lookupSquadEndpoint } from '@/lib/mobile-api/endpoints/squads'

export const GET = lookupSquadEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add `lookupSquadEndpoint` to the existing `./squads` import and append it to `ALL_ENDPOINTS`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/tournaments/lookup-squad-service.ts lib/tournaments/lookup-squad-service.test.ts lib/tournaments/squad-actions.ts lib/mobile-api/endpoints/squads.ts lib/mobile-api/endpoints/squads.test.ts app/api/mobile/v1/squads/lookup/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /squads/lookup"
```

---

### Task 7: `GET /matches/{id}/centre`

**Files:**
- Create: `lib/matches/centre-service.ts`
- Create: `lib/matches/centre-service.test.ts`
- Create: `lib/mobile-api/endpoints/match-centre.ts`
- Create: `lib/mobile-api/endpoints/match-centre.test.ts`
- Create: `app/api/mobile/v1/matches/[id]/centre/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `isMatchParticipant` (`@/lib/matches/participant`), `canCheckIn`/`checkInVerdict`/`soleAttendee` (`@/lib/matches/check-in`), `wagerWindowOpen`/`estimateWagerPayout`/`WAGER_FEE_RATE`/`MIN_WAGER_STAKE`/`MAX_WAGER_STAKE` (`@/lib/wagers/market`), `canMarkBothNoShow` (`@/lib/matches/noshow-eligibility`) — all reused unmodified, pure functions.
- Produces: `buildMatchCentre(supabase, matchId, userId: string | null) => Promise<MatchCentreView | null>` (`null` = match not found). This is genuinely new composition (spec §4) — no single existing page assembles exactly this shape, so it is designed here, not extracted.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/matches/centre-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildMatchCentre } from './centre-service'

function fakeSupabase(opts: {
  match?: Record<string, unknown> | null
  checkIns?: { player_id: string }[]
  wagers?: { pick_player_id: string; stake_coins: number }[]
  noshowFlaggedAt?: string | null
  submissionCount?: number
}) {
  return {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'match_check_ins') return { select: () => ({ eq: () => Promise.resolve({ data: opts.checkIns ?? [] }) }) }
      if (table === 'match_wagers') return { select: () => ({ eq: () => Promise.resolve({ data: opts.wagers ?? [] }) }) }
      if (table === 'match_results') return { select: (_c: string, meta?: { count?: string; head?: boolean }) => meta?.count ? { eq: () => Promise.resolve({ count: opts.submissionCount ?? 0 }) } : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) } }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

const scheduledMatch = {
  id: 'm1', status: 'scheduled', scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), is_full_day: false,
  player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null, noshow_flagged_at: null,
}

describe('buildMatchCentre', () => {
  it('returns null when the match does not exist', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: null }), 'm1', 'p1')
    expect(result).toBeNull()
  })

  it('reports the caller as a participant and check-in availability', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: scheduledMatch }), 'm1', 'p1')
    expect(result?.isParticipant).toBe(true)
    // dayReached is false (scheduled_at is 1h in the future) -> not eligible to check in yet.
    expect(result?.canCheckIn).toBe(false)
  })

  it('reports a logged-out visitor as a non-participant', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: scheduledMatch }), 'm1', null)
    expect(result?.isParticipant).toBe(false)
    expect(result?.canCheckIn).toBe(false)
  })

  it('summarizes the wager pools and reports the window as open when scheduled_at is far enough out', async () => {
    const result = await buildMatchCentre(
      fakeSupabase({ match: scheduledMatch, wagers: [{ pick_player_id: 'p1', stake_coins: 100 }, { pick_player_id: 'p2', stake_coins: 50 }] }),
      'm1', 'p3',
    )
    expect(result?.wager.pools).toEqual({ playerA: 100, playerB: 50 })
    expect(result?.wager.windowOpen).toBe(true)
  })

  it('reports noShowEligible false when nothing has been flagged', async () => {
    const result = await buildMatchCentre(fakeSupabase({ match: scheduledMatch }), 'm1', 'p1')
    expect(result?.noShowEligible).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/centre-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/matches/centre-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { isMatchParticipant } from './participant'
import { canCheckIn, checkInVerdict, soleAttendee } from './check-in'
import { canMarkBothNoShow } from './noshow-eligibility'
import { wagerWindowOpen, estimateWagerPayout, WAGER_FEE_RATE, MIN_WAGER_STAKE, MAX_WAGER_STAKE } from '@/lib/wagers/market'

export interface MatchCentreView {
  matchId: string
  status: string
  scheduledAt: string | null
  isFullDay: boolean
  isParticipant: boolean
  canCheckIn: boolean
  checkedInPlayerIds: string[]
  checkInVerdict: 'both' | 'one' | 'none'
  soleAttendeeId: string | null
  wager: {
    windowOpen: boolean
    pools: { playerA: number; playerB: number }
    feeRate: number
    minStake: number
    maxStake: number
    myPickPlayerId: string | null
    myStakeCoins: number | null
    estimatedPayoutIfIStakeA100: number
  }
  noShowEligible: boolean
}

export async function buildMatchCentre(
  supabase: SupabaseClient<Database>,
  matchId: string,
  userId: string | null,
): Promise<MatchCentreView | null> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, is_full_day, player_a_id, player_b_id, team_a_id, team_b_id, noshow_flagged_at')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return null

  const isParticipant = userId ? await isMatchParticipant(supabase, userId, match) : false
  const dayReached = match.scheduled_at != null && new Date(match.scheduled_at).getTime() <= Date.now()

  const { data: checkInRows } = await supabase.from('match_check_ins').select('player_id').eq('match_id', matchId)
  const checkedInPlayerIds = (checkInRows ?? []).map((r) => r.player_id)
  const alreadyCheckedIn = userId ? checkedInPlayerIds.includes(userId) : false
  const cis = {
    playerACheckedIn: match.player_a_id != null && checkedInPlayerIds.includes(match.player_a_id),
    playerBCheckedIn: match.player_b_id != null && checkedInPlayerIds.includes(match.player_b_id),
  }

  const { data: wagerRows } = await supabase.from('match_wagers').select('pick_player_id, stake_coins, bettor_id').eq('match_id', matchId)
  const pools = (wagerRows ?? []).reduce(
    (acc, w) => {
      if (w.pick_player_id === match.player_a_id) acc.playerA += w.stake_coins
      else if (w.pick_player_id === match.player_b_id) acc.playerB += w.stake_coins
      return acc
    },
    { playerA: 0, playerB: 0 },
  )
  const myWager = userId ? (wagerRows ?? []).find((w) => (w as { bettor_id?: string }).bettor_id === userId) : undefined

  const { count: submissionCount } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)

  return {
    matchId: match.id,
    status: match.status,
    scheduledAt: match.scheduled_at,
    isFullDay: match.is_full_day,
    isParticipant,
    canCheckIn: canCheckIn({ isParticipant, dayReached, status: match.status, alreadyCheckedIn }),
    checkedInPlayerIds,
    checkInVerdict: checkInVerdict(cis),
    soleAttendeeId: soleAttendee(cis, match.player_a_id, match.player_b_id),
    wager: {
      windowOpen: wagerWindowOpen(match),
      pools,
      feeRate: WAGER_FEE_RATE,
      minStake: MIN_WAGER_STAKE,
      maxStake: MAX_WAGER_STAKE,
      myPickPlayerId: myWager?.pick_player_id ?? null,
      myStakeCoins: myWager?.stake_coins ?? null,
      estimatedPayoutIfIStakeA100: estimateWagerPayout(pools, 'player_a', 100),
    },
    noShowEligible: canMarkBothNoShow({
      status: match.status,
      noshowFlaggedAt: match.noshow_flagged_at,
      submissionCount: submissionCount ?? 0,
    }),
  }
}
```

**Note on `estimatedPayoutIfIStakeA100`:** this is a fixed reference figure (what a 100-coin stake on player A would return right now), not a live "my actual estimated payout" — the mobile client computes the latter itself, client-side, as the stake amount changes live in the wager-placement UI, exactly like the existing web widget does with `estimateWagerPayout` imported directly (confirmed: `estimateWagerPayout`'s own doc comment calls it "informational only for the widget's live figure"). Sending one fixed reference point keeps this response static and cacheable; recomputing on every keystroke belongs client-side, not round-tripped through this endpoint.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/centre-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the endpoint's failing test**

```typescript
// lib/mobile-api/endpoints/match-centre.test.ts
import { describe, it, expect, vi } from 'vitest'

const { optionalAuth } = vi.hoisted(() => ({ optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate: vi.fn(), optionalAuth }))
const { buildMatchCentre } = vi.hoisted(() => ({ buildMatchCentre: vi.fn() }))
vi.mock('@/lib/matches/centre-service', () => ({ buildMatchCentre }))

import { matchCentreEndpoint } from './match-centre'

describe('matchCentreEndpoint', () => {
  it('404s when the match does not exist', async () => {
    optionalAuth.mockResolvedValue(null)
    buildMatchCentre.mockResolvedValue(null)
    const res = await matchCentreEndpoint.handler(new Request('https://x.test/api/mobile/v1/matches/m1/centre'), { params: { id: 'm1' } })
    expect(res.status).toBe(404)
  })

  it('passes the caller userId when logged in, null when a guest, and returns the built view', async () => {
    const view = {
      matchId: 'm1', status: 'scheduled', scheduledAt: null, isFullDay: false,
      isParticipant: true, canCheckIn: false, checkedInPlayerIds: [],
      checkInVerdict: 'none' as const, soleAttendeeId: null,
      wager: { windowOpen: false, pools: { playerA: 0, playerB: 0 }, feeRate: 0.05, minStake: 50, maxStake: 2000, myPickPlayerId: null, myStakeCoins: null, estimatedPayoutIfIStakeA100: 100 },
      noShowEligible: false,
    }
    optionalAuth.mockResolvedValue({ userClient: 'sb', userId: 'u1' })
    buildMatchCentre.mockResolvedValue(view)
    const res = await matchCentreEndpoint.handler(new Request('https://x.test/api/mobile/v1/matches/m1/centre'), { params: { id: 'm1' } })
    expect(buildMatchCentre).toHaveBeenCalledWith('sb', 'm1', 'u1')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(view)
  })
})
```

- [ ] **Step 6: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/match-centre.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/match-centre.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { buildMatchCentre } from '@/lib/matches/centre-service'

const matchCentreResponse = z.object({
  matchId: z.string(), status: z.string(), scheduledAt: z.string().nullable(), isFullDay: z.boolean(),
  isParticipant: z.boolean(), canCheckIn: z.boolean(), checkedInPlayerIds: z.array(z.string()),
  checkInVerdict: z.enum(['both', 'one', 'none']), soleAttendeeId: z.string().nullable(),
  wager: z.object({
    windowOpen: z.boolean(), pools: z.object({ playerA: z.number(), playerB: z.number() }),
    feeRate: z.number(), minStake: z.number(), maxStake: z.number(),
    myPickPlayerId: z.string().nullable(), myStakeCoins: z.number().nullable(),
    estimatedPayoutIfIStakeA100: z.number(),
  }),
  noShowEligible: z.boolean(),
})

export const matchCentreEndpoint = defineEndpoint({
  operationId: 'getMatchCentre',
  method: 'GET',
  path: '/matches/{id}/centre',
  summary: 'Composed Match Centre view: participation, check-in state, wager pools/window, no-show eligibility.',
  auth: 'public',
  response: matchCentreResponse,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const view = await buildMatchCentre(supabase, params.id, ctx?.userId ?? null)
    if (!view) throw Errors.notFound()
    return view
  },
})
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/match-centre.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the route and registry**

`app/api/mobile/v1/matches/[id]/centre/route.ts`:

```typescript
import { matchCentreEndpoint } from '@/lib/mobile-api/endpoints/match-centre'

export const GET = matchCentreEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `matchCentreEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/matches/centre-service.ts lib/matches/centre-service.test.ts lib/mobile-api/endpoints/match-centre.ts lib/mobile-api/endpoints/match-centre.test.ts app/api/mobile/v1/matches/[id]/centre/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /matches/{id}/centre"
```

---

### Task 8: `POST /matches/{id}/check-in`

**Files:**
- Create: `lib/matches/check-in-service.ts`
- Create: `lib/matches/check-in-service.test.ts`
- Modify: `lib/matches/check-in-actions.ts` (thin wrapper)
- Create: `lib/mobile-api/endpoints/check-in.ts`
- Create: `lib/mobile-api/endpoints/check-in.test.ts`
- Create: `app/api/mobile/v1/matches/[id]/check-in/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `canCheckIn` (`@/lib/matches/check-in`), `isMatchParticipant` (`@/lib/matches/participant`) — reused unmodified.
- Produces: `performCheckIn(supabase, admin, userId, matchId) => Promise<{ok: true} | {ok: false, errorCode: CheckInErrorCode}>`, `CheckInErrorCode = 'match_not_found' | 'not_participant' | 'not_match_day' | 'check_in_closed' | 'check_in_failed'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/matches/check-in-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performCheckIn } from './check-in-service'

function fakeSupabase(opts: { match?: Record<string, unknown> | null; existing?: { id: string } | null }) {
  return {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'match_check_ins') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}
function fakeAdmin(opts: { insertError?: { code?: string } | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  return { from: (table: string) => { if (table !== 'match_check_ins') throw new Error(`unexpected table ${table}`); return { insert } }, __insert: insert } as never
}

const past = new Date(Date.now() - 3_600_000).toISOString()
const future = new Date(Date.now() + 3_600_000).toISOString()

describe('performCheckIn', () => {
  it('reports match_not_found', async () => {
    const result = await performCheckIn(fakeSupabase({ match: null }), fakeAdmin(), 'p1', 'm1')
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports not_participant for a non-participant', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match }), fakeAdmin(), 'stranger', 'm1')
    expect(result).toEqual({ ok: false, errorCode: 'not_participant' })
  })

  it('reports not_match_day before scheduled_at has passed', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: future, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match }), fakeAdmin(), 'p1', 'm1')
    expect(result).toEqual({ ok: false, errorCode: 'not_match_day' })
  })

  it('treats an already-checked-in participant as a benign success', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match, existing: { id: 'ci1' } }), fakeAdmin(), 'p1', 'm1')
    expect(result).toEqual({ ok: true })
  })

  it('inserts a check-in for a participant on match day', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const admin = fakeAdmin()
    const result = await performCheckIn(fakeSupabase({ match }), admin, 'p1', 'm1')
    expect(result).toEqual({ ok: true })
    expect((admin as unknown as { __insert: ReturnType<typeof vi.fn> }).__insert).toHaveBeenCalledWith({ match_id: 'm1', player_id: 'p1' })
  })

  it('treats a 23505 unique-violation as a benign success (race with itself)', async () => {
    const match = { id: 'm1', status: 'scheduled', scheduled_at: past, player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
    const result = await performCheckIn(fakeSupabase({ match }), fakeAdmin({ insertError: { code: '23505' } }), 'p1', 'm1')
    expect(result).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/check-in-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Extracted from `checkInToMatch` in `lib/matches/check-in-actions.ts`, every branch preserved including the "already checked in → benign success" and 23505-swallow cases:

```typescript
// lib/matches/check-in-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { canCheckIn } from './check-in'
import { isMatchParticipant } from './participant'

type Admin = ReturnType<typeof createAdminClient>

export type CheckInErrorCode = 'match_not_found' | 'not_participant' | 'not_match_day' | 'check_in_closed' | 'check_in_failed'
export type CheckInResult = { ok: true } | { ok: false; errorCode: CheckInErrorCode }

export async function performCheckIn(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  matchId: string,
): Promise<CheckInResult> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }

  const isParticipant = await isMatchParticipant(supabase, userId, match)
  const dayReached = match.scheduled_at != null && new Date(match.scheduled_at).getTime() <= Date.now()

  const { data: existing } = await supabase
    .from('match_check_ins')
    .select('id')
    .eq('match_id', matchId)
    .eq('player_id', userId)
    .maybeSingle()

  if (!canCheckIn({ isParticipant, dayReached, status: match.status, alreadyCheckedIn: !!existing })) {
    if (!isParticipant) return { ok: false, errorCode: 'not_participant' }
    if (existing) return { ok: true }
    if (!dayReached) return { ok: false, errorCode: 'not_match_day' }
    return { ok: false, errorCode: 'check_in_closed' }
  }

  const { error } = await admin.from('match_check_ins').insert({ match_id: matchId, player_id: userId })
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, errorCode: 'check_in_failed' }

  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/check-in-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service**

In `lib/matches/check-in-actions.ts`, `checkInToMatch` becomes: parse `matchId` from `formData`, require login, call `performCheckIn(supabase, createAdminClient(), user.id, matchId)`, map `errorCode` to the existing messages (`match_not_found` → `'Match not found.'`, `not_participant` → `"You're not playing in this match."`, `not_match_day` → `"You can check in once it's match day."`, `check_in_closed` → `'This match is no longer open for check-in.'`, `check_in_failed` → `'Could not check you in. Please try again.'`), keep the existing `revalidatePath('/matches/${matchId}')` and `revalidatePath('/admin/matches/${matchId}/review')` calls after success.

Run: `find lib/matches -iname "check-in-actions.test.ts"` first — if no such file exists, skip to Step 6.

- [ ] **Step 6: Write the endpoint's failing test**

```typescript
// lib/mobile-api/endpoints/check-in.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { performCheckIn } = vi.hoisted(() => ({ performCheckIn: vi.fn() }))
vi.mock('@/lib/matches/check-in-service', () => ({ performCheckIn }))

import { checkInEndpoint } from './check-in'

function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/check-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
}

describe('checkInEndpoint', () => {
  it('returns {success: true} and calls performCheckIn with ctx pieces + params.id', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    performCheckIn.mockResolvedValue({ ok: true })
    const res = await checkInEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(performCheckIn).toHaveBeenCalledWith('sb', 'admin', 'u1', 'm1')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps not_match_day to a 400', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    performCheckIn.mockResolvedValue({ ok: false, errorCode: 'not_match_day' })
    const res = await checkInEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('not_match_day')
  })
})
```

- [ ] **Step 7: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/check-in.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/check-in.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performCheckIn, type CheckInErrorCode } from '@/lib/matches/check-in-service'

const checkInResponse = z.object({ success: z.literal(true) })

const STATUS: Record<CheckInErrorCode, number> = {
  match_not_found: 404, not_participant: 403, not_match_day: 400, check_in_closed: 409, check_in_failed: 500,
}
const MESSAGE: Record<CheckInErrorCode, string> = {
  match_not_found: 'Match not found.',
  not_participant: "You're not playing in this match.",
  not_match_day: "You can check in once it's match day.",
  check_in_closed: 'This match is no longer open for check-in.',
  check_in_failed: 'Could not check you in. Please try again.',
}

export const checkInEndpoint = defineEndpoint({
  operationId: 'postMatchCheckIn',
  method: 'POST',
  path: '/matches/{id}/check-in',
  summary: 'Mark the signed-in player present for a match.',
  auth: 'user',
  response: checkInResponse,
  handler: async ({ ctx, params }) => {
    const result = await performCheckIn(ctx.userClient, ctx.admin, ctx.userId, params.id)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
```

No `idempotent: true` — per spec §5, a one-time flag flip is naturally idempotent (re-tapping an already-checked-in state returns `{ok: true}`, not an error).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/check-in.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the route and registry**

`app/api/mobile/v1/matches/[id]/check-in/route.ts`:

```typescript
import { checkInEndpoint } from '@/lib/mobile-api/endpoints/check-in'

export const POST = checkInEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `checkInEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/matches/check-in-service.ts lib/matches/check-in-service.test.ts lib/matches/check-in-actions.ts lib/mobile-api/endpoints/check-in.ts lib/mobile-api/endpoints/check-in.test.ts app/api/mobile/v1/matches/[id]/check-in/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /matches/{id}/check-in"
```

---

### Task 9: `POST /matches/{id}/result`

**Files:**
- Create: `lib/matches/submit-result-service.ts`
- Create: `lib/matches/submit-result-service.test.ts`
- Modify: `lib/matches/actions.ts` (thin wrapper)
- Create: `lib/mobile-api/endpoints/match-result.ts`
- Create: `lib/mobile-api/endpoints/match-result.test.ts`
- Create: `app/api/mobile/v1/matches/[id]/result/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `submitResultSchema` (`@/lib/matches/schema`), `isMatchParticipant` (`@/lib/matches/participant`), `notifyStaff`/`resultNotification`/`opponentSubmissionNotice`/`notifyBoth` — all reused unmodified, including the notification side-effects (a mobile submission must trigger the same staff/opponent notifications the web path does — this is not something to strip out).
- Produces: `performSubmitMatchResult(supabase, admin, userId, matchId, input: {scoreA, scoreB, recordingUrl, screenshotPath}) => Promise<{ok: true} | {ok: false, errorCode: SubmitResultErrorCode}>`, `SubmitResultErrorCode = 'match_not_found' | 'bye_no_result' | 'not_participant' | 'match_cancelled' | 'already_confirmed' | 'submission_locked' | 'screenshot_required' | 'validation_failed' | 'submit_failed'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/matches/submit-result-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performSubmitMatchResult } from './submit-result-service'

vi.mock('@/lib/admin/staff', () => ({ notifyStaff: vi.fn() }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: vi.fn() }))

function fakeSupabase(opts: {
  match?: Record<string, unknown> | null
  existing?: { id: string; status: string; screenshot_url: string | null } | null
  priorCount?: number
  matchDetail?: Record<string, unknown> | null
}) {
  return {
    from: (table: string) => {
      if (table === 'matches') {
        return {
          select: (cols: string) =>
            cols.includes('player_a:profiles')
              ? { eq: () => ({ maybeSingle: async () => ({ data: opts.matchDetail ?? null }) }) }
              : { eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) },
        }
      }
      if (table === 'match_results') {
        return {
          select: (_c: string, meta?: { count?: string; head?: boolean }) =>
            meta?.count
              ? { eq: () => Promise.resolve({ count: opts.priorCount ?? 0 }) }
              : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}
function fakeAdmin(opts: { upsertError?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const admin = {
    from: (table: string) => {
      if (table === 'match_results') return { upsert }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, upsert }
}

const openMatch = { id: 'm1', player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null, status: 'scheduled' }
const input = { scoreA: 3, scoreB: 1, recordingUrl: '', screenshotPath: 'shots/1.png' }

describe('performSubmitMatchResult', () => {
  it('reports match_not_found', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: null }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports bye_no_result for a bye', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: { ...openMatch, status: 'bye' } }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'bye_no_result' })
  })

  it('reports not_participant for a non-participant', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), fakeAdmin().admin, 'stranger', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'not_participant' })
  })

  it('reports match_cancelled', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: { ...openMatch, status: 'cancelled' } }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'match_cancelled' })
  })

  it('reports already_confirmed for a completed match', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: { ...openMatch, status: 'completed' } }), fakeAdmin().admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'already_confirmed' })
  })

  it('reports submission_locked when the caller already has a non-pending submission', async () => {
    const result = await performSubmitMatchResult(
      fakeSupabase({ match: openMatch, existing: { id: 'r1', status: 'confirmed', screenshot_url: 'shots/old.png' } }),
      fakeAdmin().admin, 'p1', 'm1', input,
    )
    expect(result).toEqual({ ok: false, errorCode: 'submission_locked' })
  })

  it('reports screenshot_required when no screenshot path is given and none exists yet', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), fakeAdmin().admin, 'p1', 'm1', { ...input, screenshotPath: '' })
    expect(result).toEqual({ ok: false, errorCode: 'screenshot_required' })
  })

  it('reports validation_failed for an out-of-range score', async () => {
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), fakeAdmin().admin, 'p1', 'm1', { ...input, scoreA: -1 })
    expect(result).toEqual({ ok: false, errorCode: 'validation_failed' })
  })

  it('upserts the result and returns ok on a valid submission with no match-detail row (notifications skipped)', async () => {
    const { admin, upsert } = fakeAdmin()
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch, matchDetail: null }), admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ match_id: 'm1', submitted_by: 'p1', score_a: 3, score_b: 1, screenshot_url: 'shots/1.png', status: 'pending' }),
      { onConflict: 'match_id,submitted_by' },
    )
  })

  it('reports submit_failed when the upsert errors', async () => {
    const { admin } = fakeAdmin({ upsertError: { message: 'db down' } })
    const result = await performSubmitMatchResult(fakeSupabase({ match: openMatch }), admin, 'p1', 'm1', input)
    expect(result).toEqual({ ok: false, errorCode: 'submit_failed' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/matches/submit-result-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Extracted from `submitMatchResult` in `lib/matches/actions.ts` — every branch preserved, including the notify-on-every-submission behavior (the "old `if (!priorSubmissionCount)` gate" comment already present in the source explains why it must NOT be re-narrowed to first-submission-only):

```typescript
// lib/matches/submit-result-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { submitResultSchema } from './schema'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
import { opponentSubmissionNotice } from './submission-notice'
import { isMatchParticipant } from './participant'
import { notifyBoth } from '@/lib/notifications/send'

type Admin = ReturnType<typeof createAdminClient>

export type SubmitResultErrorCode =
  | 'match_not_found' | 'bye_no_result' | 'not_participant' | 'match_cancelled' | 'already_confirmed'
  | 'submission_locked' | 'screenshot_required' | 'validation_failed' | 'submit_failed'
export type SubmitResultResult = { ok: true } | { ok: false; errorCode: SubmitResultErrorCode }

type NameRef = { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null
type ReviewMatchRow = { player_a: NameRef; player_b: NameRef; tournament: { title: string } | { title: string }[] | null }

export async function performSubmitMatchResult(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  matchId: string,
  input: { scoreA: number; scoreB: number; recordingUrl: string; screenshotPath: string },
): Promise<SubmitResultResult> {
  const parsed = submitResultSchema.safeParse({ scoreA: input.scoreA, scoreB: input.scoreB, recordingUrl: input.recordingUrl })
  if (!parsed.success) return { ok: false, errorCode: 'validation_failed' }

  const { data: match } = await supabase
    .from('matches')
    .select('id, player_a_id, player_b_id, team_a_id, team_b_id, status')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }
  if (match.status === 'bye') return { ok: false, errorCode: 'bye_no_result' }
  if (!(await isMatchParticipant(supabase, userId, match))) return { ok: false, errorCode: 'not_participant' }
  if (match.status === 'cancelled') return { ok: false, errorCode: 'match_cancelled' }
  if (match.status === 'completed') return { ok: false, errorCode: 'already_confirmed' }

  const { data: existing } = await supabase
    .from('match_results')
    .select('id, status, screenshot_url')
    .eq('match_id', matchId)
    .eq('submitted_by', userId)
    .maybeSingle()
  if (existing && existing.status !== 'pending') return { ok: false, errorCode: 'submission_locked' }

  const { count: priorSubmissionCount } = await supabase
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)

  const finalScreenshot = input.screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { ok: false, errorCode: 'screenshot_required' }

  const recordingUrl = parsed.data.recordingUrl && parsed.data.recordingUrl !== '' ? parsed.data.recordingUrl : null

  const { error } = await admin.from('match_results').upsert(
    {
      match_id: matchId, submitted_by: userId, score_a: parsed.data.scoreA, score_b: parsed.data.scoreB,
      screenshot_url: finalScreenshot, recording_url: recordingUrl, status: 'pending',
    },
    { onConflict: 'match_id,submitted_by' },
  )
  if (error) return { ok: false, errorCode: 'submit_failed' }

  const { data: mdRaw } = await admin
    .from('matches')
    .select(
      'player_a:profiles!matches_player_a_id_fkey(display_name, username), ' +
        'player_b:profiles!matches_player_b_id_fkey(display_name, username), ' +
        'tournament:tournaments(title)',
    )
    .eq('id', matchId)
    .maybeSingle()
  const md = (mdRaw ?? null) as unknown as ReviewMatchRow | null
  if (md) {
    const nameOf = (x: NameRef) => {
      const r = Array.isArray(x) ? x[0] ?? null : x
      return r?.display_name ?? r?.username ?? null
    }
    const tRef = Array.isArray(md.tournament) ? md.tournament[0] : md.tournament
    const tournamentTitle = tRef?.title ?? 'Tournament'
    const playerAName = nameOf(md.player_a as NameRef)
    const playerBName = nameOf(md.player_b as NameRef)

    if (!priorSubmissionCount) {
      const notification = resultNotification({
        type: 'result_needs_review', tournamentTitle,
        playerAName: playerAName ?? 'Player', playerBName: playerBName ?? 'Player', createdAt: new Date().toISOString(),
      })
      await notifyStaff(admin, 'result_needs_review', { title: notification.title, body: notification.body, link: notification.link })
    }

    const notice = opponentSubmissionNotice({
      matchId, submitterId: userId, playerAId: match.player_a_id, playerBId: match.player_b_id,
      playerAName, playerBName, tournamentTitle, scoreA: parsed.data.scoreA, scoreB: parsed.data.scoreB,
      isResubmission: Boolean(existing),
    })
    if (notice) await notifyBoth(notice.recipientId, notice.notification, 'result_submitted', { link: notice.link })
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/matches/submit-result-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service**

In `lib/matches/actions.ts`, `submitMatchResult` becomes: parse `matchId`/`screenshotPath` from `formData`, call `performSubmitMatchResult(supabase, createAdminClient(), user.id, matchId, {scoreA: formData.get('scoreA'), scoreB: formData.get('scoreB'), recordingUrl: formData.get('recordingUrl') ?? '', screenshotPath})` (note: the service does its own `submitResultSchema.safeParse`, so pass the raw `FormDataEntryValue`s through as-is — the service's zod schema already has `z.coerce.number()` on the score fields, so it accepts the same raw strings the original inline `parsed.success` check did), map `errorCode` to the existing messages (`match_not_found` → `'Match not found.'`, `bye_no_result` → `'This is a bye — there is no result to submit.'`, `not_participant` → `'Only the players in this match can submit a result.'`, `match_cancelled` → `'This match was cancelled.'`, `already_confirmed` → `'This match result is already confirmed.'`, `submission_locked` → `'Your submission is under review and can no longer be edited.'`, `screenshot_required` → `'A screenshot is required.'`, `validation_failed` → reuse `parsed.error.issues[0].message` by re-running `submitResultSchema.safeParse` in the action before calling the service purely to extract the field-specific message for this one case — the service's generic `validation_failed` code loses per-field detail, and the existing web UI depends on that detail; alternatively, thread the zod error through the service's return value as an optional field — pick whichever keeps the action's existing error-message behavior byte-for-byte, since this is a pure refactor task and the web UI's test coverage (if any) must not regress), `submit_failed` → `'Could not submit your result. Please try again.'`, keep the existing `revalidatePath('/matches/${matchId}')` call after success.

Run: `find lib/matches -iname "actions.test.ts"` first — if it exists, its existing assertions on `submitMatchResult`'s error messages are what determine whether the "thread the zod error through" approach above is required; if it exists and asserts specific validation messages, take that approach; otherwise the simpler generic `'validation_failed'` → a fixed message like `'Please check your score entries.'` is acceptable and this note can be resolved either way without a test to satisfy.

- [ ] **Step 6: Write the endpoint's failing test**

`POST /matches/{id}/result` is `idempotent: true` — same `runIdempotent` pass-through mock and `idempotency-key` header as Task 5's `createSquadEndpoint` test.

```typescript
// lib/mobile-api/endpoints/match-result.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performSubmitMatchResult } = vi.hoisted(() => ({ performSubmitMatchResult: vi.fn() }))
vi.mock('@/lib/matches/submit-result-service', () => ({ performSubmitMatchResult }))

import { matchResultEndpoint } from './match-result'

const body = { scoreA: 3, scoreB: 1, recordingUrl: '', screenshotPath: 'shots/1.png' }
function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/result', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify(body),
  })
}

describe('matchResultEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitMatchResult.mockResolvedValue({ ok: true })
    const res = await matchResultEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(performSubmitMatchResult).toHaveBeenCalledWith('sb', 'admin', 'u1', 'm1', body)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps already_confirmed to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitMatchResult.mockResolvedValue({ ok: false, errorCode: 'already_confirmed' })
    const res = await matchResultEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_confirmed')
  })
})
```

- [ ] **Step 7: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/match-result.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/match-result.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performSubmitMatchResult, type SubmitResultErrorCode } from '@/lib/matches/submit-result-service'

const matchResultBody = z.object({
  scoreA: z.number().int().min(0).max(99),
  scoreB: z.number().int().min(0).max(99),
  recordingUrl: z.string().optional().default(''),
  screenshotPath: z.string(),
})
const matchResultResponse = z.object({ success: z.literal(true) })

const STATUS: Record<SubmitResultErrorCode, number> = {
  match_not_found: 404, bye_no_result: 400, not_participant: 403, match_cancelled: 409,
  already_confirmed: 409, submission_locked: 409, screenshot_required: 400, validation_failed: 400, submit_failed: 500,
}
const MESSAGE: Record<SubmitResultErrorCode, string> = {
  match_not_found: 'Match not found.',
  bye_no_result: 'This is a bye — there is no result to submit.',
  not_participant: 'Only the players in this match can submit a result.',
  match_cancelled: 'This match was cancelled.',
  already_confirmed: 'This match result is already confirmed.',
  submission_locked: 'Your submission is under review and can no longer be edited.',
  screenshot_required: 'A screenshot is required.',
  validation_failed: 'Please check your score entries.',
  submit_failed: 'Could not submit your result. Please try again.',
}

export const matchResultEndpoint = defineEndpoint({
  operationId: 'postMatchResult',
  method: 'POST',
  path: '/matches/{id}/result',
  summary: 'Submit a match result (screenshot required) for admin review.',
  auth: 'user',
  idempotent: true,
  body: matchResultBody,
  response: matchResultResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performSubmitMatchResult(ctx.userClient, ctx.admin, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/match-result.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the route and registry**

`app/api/mobile/v1/matches/[id]/result/route.ts`:

```typescript
import { matchResultEndpoint } from '@/lib/mobile-api/endpoints/match-result'

export const POST = matchResultEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `matchResultEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/matches/submit-result-service.ts lib/matches/submit-result-service.test.ts lib/matches/actions.ts lib/mobile-api/endpoints/match-result.ts lib/mobile-api/endpoints/match-result.test.ts app/api/mobile/v1/matches/[id]/result/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /matches/{id}/result"
```

---

### Task 10: `POST /matches/{id}/rating`

**Files:**
- Create: `lib/scoring/opponent-rating-service.ts`
- Create: `lib/scoring/opponent-rating-service.test.ts`
- Create: `lib/mobile-api/endpoints/rating.ts`
- Create: `lib/mobile-api/endpoints/rating.test.ts`
- Create: `app/api/mobile/v1/matches/[id]/rating/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `refreshPlayer(admin, playerId)` from `@/lib/scoring/apply` (reused unmodified — the same function the admin-flag-conduct action already calls after an authored `sx_score_events` insert, confirmed at `lib/tournaments/registrations-admin-actions.ts:45-56`).
- Produces: `submitOpponentRating(admin, {matchId, raterId, stars}) => Promise<{ok: true} | {ok: false, errorCode: RatingErrorCode}>`, `RatingErrorCode = 'match_not_found' | 'not_a_participant' | 'result_not_confirmed_yet' | 'cannot_rate_self' | 'not_ratable' | 'already_rated'`.

**Genuinely new logic — no extraction, per spec §6.** `event_type: 'rating_received'` is already permitted by `sx_score_events`'s CHECK constraint (`supabase/migrations/008_win_no_dispute_event.sql`) — no migration in this task. **Solo matches only**: a squad match's `player_a_id`/`player_b_id` are both null (per `isMatchParticipant`'s own branching, confirmed in Task 7/8/9), so there is no single "opponent" to rate — reject with `not_ratable` rather than inventing team-rating semantics nothing in the spec asked for.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/scoring/opponent-rating-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { submitOpponentRating } from './opponent-rating-service'

vi.mock('./apply', () => ({ refreshPlayer: vi.fn() }))
import { refreshPlayer } from './apply'

function fakeAdmin(opts: { match?: Record<string, unknown> | null; insertError?: { code?: string } | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null })
  const admin = {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'sx_score_events') return { insert }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, insert }
}

const completedMatch = { id: 'm1', status: 'completed', player_a_id: 'p1', player_b_id: 'p2', team_a_id: null, team_b_id: null }
const teamMatch = { id: 'm2', status: 'completed', player_a_id: null, player_b_id: null, team_a_id: 'sq1', team_b_id: 'sq2' }

describe('submitOpponentRating', () => {
  it('reports match_not_found', async () => {
    const { admin } = fakeAdmin({ match: null })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports not_a_participant for a non-participant', async () => {
    const { admin } = fakeAdmin({ match: completedMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'stranger', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'not_a_participant' })
  })

  it('reports result_not_confirmed_yet for a match that has not completed', async () => {
    const { admin } = fakeAdmin({ match: { ...completedMatch, status: 'scheduled' } })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'result_not_confirmed_yet' })
  })

  it('reports not_ratable for a team match', async () => {
    const { admin } = fakeAdmin({ match: teamMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm2', raterId: 'anyone', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'not_ratable' })
  })

  it('reports already_rated on a 23505 unique-violation', async () => {
    const { admin } = fakeAdmin({ match: completedMatch, insertError: { code: '23505' } })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: false, errorCode: 'already_rated' })
  })

  it('inserts +20 for a 5-star rating and refreshes the rated player', async () => {
    const { admin, insert } = fakeAdmin({ match: completedMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 5 })
    expect(result).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith({ player_id: 'p2', match_id: 'm1', event_type: 'rating_received', points_delta: 20 })
    expect(refreshPlayer).toHaveBeenCalledWith(admin, 'p2')
  })

  it('inserts +10 for a 4-star rating', async () => {
    const { admin, insert } = fakeAdmin({ match: completedMatch })
    await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 4 })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ points_delta: 10 }))
  })

  it('inserts -20 for a 1 or 2-star rating', async () => {
    const { admin, insert } = fakeAdmin({ match: completedMatch })
    await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p2', stars: 1 })
    expect(insert).toHaveBeenCalledWith({ player_id: 'p1', match_id: 'm1', event_type: 'rating_received', points_delta: -20 })
  })

  it('records a 3-star rating with no sx_score_events row and no refresh', async () => {
    const { admin, insert } = fakeAdmin({ match: completedMatch })
    const result = await submitOpponentRating(admin, { matchId: 'm1', raterId: 'p1', stars: 3 })
    expect(result).toEqual({ ok: true })
    expect(insert).not.toHaveBeenCalled()
    expect(refreshPlayer).not.toHaveBeenCalled()
  })
})
```

Note: the "3-star → no event" branch still needs a durable record that this rater has rated this match once, to make a second attempt hit `already_rated` — but `sx_score_events` has no row to anchor that uniqueness check on for 3★ specifically, since no event is written. Resolve this in Step 3 by **always inserting into `opponent_ratings`** (which has the real `UNIQUE(match_id, rater_id)` constraint, per CLAUDE.md's schema note — `001_initial_schema.sql`) regardless of star count, and only conditionally inserting into `sx_score_events` on top of that when `stars !== 3`. The test above only asserts on the `sx_score_events` insert mock; add one more assertion to the 3-star test confirming a `mock.opponent_ratings.insert` (a second `from` branch in `fakeAdmin`, added in Step 1 before writing the implementation) was still called — write that additional fake-admin branch and assertion now, before Step 2, since the implementation in Step 3 depends on it existing.

- [ ] **Step 2: Add the `opponent_ratings` branch to `fakeAdmin` and the corresponding assertions, then run to verify failure**

Update `fakeAdmin` in the test file to also handle `table === 'opponent_ratings'`, returning an `insert` mock (`ratingInsert`) alongside the existing `sx_score_events` `insert` mock, and add `expect(ratingInsert).toHaveBeenCalledWith({ match_id: 'm1', rater_id: 'p1', rated_id: 'p2', stars: 5 })`-style assertions to the 5-star, 4-star, 1-star, and 3-star tests above (return `{ error: null }` from `ratingInsert` in the default case; the `already_rated` test instead sets `ratingInsert`'s error to `{ code: '23505' }`, not the `sx_score_events` insert's — move that error there since the `opponent_ratings` insert is the one with the real unique constraint).

Run: `npx vitest run lib/scoring/opponent-rating-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/scoring/opponent-rating-service.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { refreshPlayer } from './apply'

type Admin = ReturnType<typeof createAdminClient>

export type RatingErrorCode =
  | 'match_not_found' | 'not_a_participant' | 'result_not_confirmed_yet' | 'cannot_rate_self' | 'not_ratable' | 'already_rated'
export type RatingResult = { ok: true } | { ok: false; errorCode: RatingErrorCode }

const DELTA_BY_STARS: Record<number, number> = { 5: 20, 4: 10, 3: 0, 2: -20, 1: -20 }

export async function submitOpponentRating(
  admin: Admin,
  input: { matchId: string; raterId: string; stars: 1 | 2 | 3 | 4 | 5 },
): Promise<RatingResult> {
  const { data: match } = await admin
    .from('matches')
    .select('id, status, player_a_id, player_b_id, team_a_id, team_b_id')
    .eq('id', input.matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }
  if (match.player_a_id === null && match.player_b_id === null) return { ok: false, errorCode: 'not_ratable' }
  if (input.raterId !== match.player_a_id && input.raterId !== match.player_b_id) return { ok: false, errorCode: 'not_a_participant' }
  if (match.status !== 'completed') return { ok: false, errorCode: 'result_not_confirmed_yet' }

  const ratedId = input.raterId === match.player_a_id ? match.player_b_id : match.player_a_id
  if (!ratedId) return { ok: false, errorCode: 'not_ratable' } // defensive: should be unreachable given the checks above

  const { error: ratingError } = await admin
    .from('opponent_ratings')
    .insert({ match_id: input.matchId, rater_id: input.raterId, rated_id: ratedId, stars: input.stars })
  if (ratingError) {
    if ((ratingError as { code?: string }).code === '23505') return { ok: false, errorCode: 'already_rated' }
    return { ok: false, errorCode: 'already_rated' } // any other insert failure here is also treated as "can't rate again" rather than a 500 — the rating itself is non-critical, never block on it
  }

  const delta = DELTA_BY_STARS[input.stars]
  if (delta !== 0) {
    await admin.from('sx_score_events').insert({ player_id: ratedId, match_id: input.matchId, event_type: 'rating_received', points_delta: delta })
    await refreshPlayer(admin, ratedId)
  }

  return { ok: true }
}
```

**Re-check before finalizing:** the fallback `return { ok: false, errorCode: 'already_rated' }` for a non-23505 insert error on `opponent_ratings` is a deliberate simplification (this service intentionally has no generic `insert_failed` code, since a rating write failing for any reason should degrade the same way — silently blocking a second attempt rather than surfacing a 500 for a non-critical feature) — confirm this reads correctly against the test suite once written; if a non-23505 branch needs distinct test coverage, add it as a 6th error code (`rating_failed`) instead of overloading `already_rated`, and update `RATING_STATUS`/`RATING_MESSAGE` in the endpoint (Step 5) to match.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/scoring/opponent-rating-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the endpoint's failing test**

`POST /matches/{id}/rating` is `idempotent: true` — same `runIdempotent` pass-through pattern.

```typescript
// lib/mobile-api/endpoints/rating.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { submitOpponentRating } = vi.hoisted(() => ({ submitOpponentRating: vi.fn() }))
vi.mock('@/lib/scoring/opponent-rating-service', () => ({ submitOpponentRating }))

import { ratingEndpoint } from './rating'

function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/rating', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify({ stars: 5 }),
  })
}

describe('ratingEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    submitOpponentRating.mockResolvedValue({ ok: true })
    const res = await ratingEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(submitOpponentRating).toHaveBeenCalledWith('admin', { matchId: 'm1', raterId: 'u1', stars: 5 })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps already_rated to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    submitOpponentRating.mockResolvedValue({ ok: false, errorCode: 'already_rated' })
    const res = await ratingEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_rated')
  })
})
```

- [ ] **Step 6: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/rating.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/rating.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { submitOpponentRating, type RatingErrorCode } from '@/lib/scoring/opponent-rating-service'

const ratingBody = z.object({ stars: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]) })
const ratingResponse = z.object({ success: z.literal(true) })

const STATUS: Record<RatingErrorCode, number> = {
  match_not_found: 404, not_a_participant: 403, result_not_confirmed_yet: 409,
  cannot_rate_self: 400, not_ratable: 400, already_rated: 409,
}
const MESSAGE: Record<RatingErrorCode, string> = {
  match_not_found: 'Match not found.',
  not_a_participant: 'Only the players in this match can rate each other.',
  result_not_confirmed_yet: 'You can rate your opponent once the result is confirmed.',
  cannot_rate_self: 'You cannot rate yourself.',
  not_ratable: 'This match cannot be rated.',
  already_rated: "You've already rated this match.",
}

export const ratingEndpoint = defineEndpoint({
  operationId: 'postMatchRating',
  method: 'POST',
  path: '/matches/{id}/rating',
  summary: 'Rate your opponent 1-5 stars after a confirmed match result.',
  auth: 'user',
  idempotent: true,
  body: ratingBody,
  response: ratingResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await submitOpponentRating(ctx.admin, { matchId: params.id, raterId: ctx.userId, stars: body.stars })
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
```

`cannot_rate_self` is listed in the status/message maps for completeness (spec §6 names it as a rejection case) even though the service's own logic (Step 3) never actually reaches it as a distinct branch — a self-rating attempt already fails as `not_a_participant` is impossible to trigger (the rater IS one of the two participants by definition once `not_a_participant` passes, and `ratedId` is always the *other* participant, never `raterId`, so there is no code path where `raterId === ratedId`). Leave the error code defined (a defensive no-op branch, cheap to keep, costs nothing) but do not force a test to exercise an unreachable branch — if `npm run test`'s coverage tooling flags it, that is expected and fine here, not a gap to chase.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/rating.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the route and registry**

`app/api/mobile/v1/matches/[id]/rating/route.ts`:

```typescript
import { ratingEndpoint } from '@/lib/mobile-api/endpoints/rating'

export const POST = ratingEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `ratingEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/scoring/opponent-rating-service.ts lib/scoring/opponent-rating-service.test.ts lib/mobile-api/endpoints/rating.ts lib/mobile-api/endpoints/rating.test.ts app/api/mobile/v1/matches/[id]/rating/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /matches/{id}/rating (new opponent-rating logic)"
```

---

### Task 11: `POST /matches/{id}/wager`

**Files:**
- Create: `lib/wagers/place-wager-service.ts`
- Create: `lib/wagers/place-wager-service.test.ts`
- Modify: `lib/wagers/actions.ts` (thin wrapper)
- Create: `lib/mobile-api/endpoints/wager.ts`
- Create: `lib/mobile-api/endpoints/wager.test.ts`
- Create: `app/api/mobile/v1/matches/[id]/wager/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `placeWagerSchema` (`@/lib/wagers/schema`), `wagerWindowOpen` (`@/lib/wagers/market`), `getCoinBalance`/`recordCoinTransaction` (`@/lib/coins/service`), `assertNotPendingDeletion` (`@/lib/settings/restriction`) — all reused unmodified.
- Produces: `performPlaceWager(supabase, admin, userId, matchId, input: {pickPlayerId, stakeCoins}) => Promise<{ok: true} | {ok: false, errorCode: PlaceWagerErrorCode}>`, `PlaceWagerErrorCode = 'pending_deletion' | 'match_not_found' | 'own_match' | 'invalid_pick' | 'window_closed' | 'insufficient_coins' | 'wager_failed' | 'validation_failed'`.

**Note:** the path already carries `matchId` (`/matches/{id}/wager`) — the body no longer needs a redundant `matchId` field the way the web form's hidden input does (spec convention: path params replace duplicated body fields wherever a route is per-resource, matching how `register`/`waitlist` in 2a never repeat `{id}` in their bodies either).

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/wagers/place-wager-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performPlaceWager } from './place-wager-service'

vi.mock('@/lib/coins/service', () => ({ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/settings/restriction', () => ({ assertNotPendingDeletion: vi.fn() }))
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

function fakeAdmin(opts: { match?: Record<string, unknown> | null; existing?: { id: string; stake_coins: number } | null; upsertError?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const admin = {
    from: (table: string) => {
      if (table === 'matches') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.match ?? null }) }) }) }
      if (table === 'match_wagers') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) }), upsert }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, upsert }
}

const openMatch = { id: 'm1', status: 'scheduled', scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), player_a_id: 'p1', player_b_id: 'p2', is_full_day: false }

describe('performPlaceWager', () => {
  it('reports pending_deletion when the account is restricted', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue('Your account is pending deletion.')
    const { admin } = fakeAdmin()
    const result = await performPlaceWager({} as never, admin, 'u1', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'pending_deletion' })
  })

  it('reports match_not_found', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: null })
    const result = await performPlaceWager({} as never, admin, 'u1', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'match_not_found' })
  })

  it('reports own_match when the caller is one of the two players', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'p1', 'm1', { pickPlayerId: 'p2', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'own_match' })
  })

  it('reports invalid_pick when pickPlayerId is neither player', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'someone-else', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'invalid_pick' })
  })

  it('reports window_closed once wagering has closed', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    const { admin } = fakeAdmin({ match: { ...openMatch, scheduled_at: new Date(Date.now() - 3_600_000).toISOString() } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'window_closed' })
  })

  it('reports insufficient_coins', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(50)
    const { admin } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'insufficient_coins' })
  })

  it('places a fresh wager, debiting the full stake once', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(200)
    const { admin, upsert } = fakeAdmin({ match: openMatch })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: true })
    expect(recordCoinTransaction).toHaveBeenCalledTimes(1)
    expect(recordCoinTransaction).toHaveBeenCalledWith(admin, 'u3', -100, 'wager_stake', 'm1', 'Wager — match m1')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ match_id: 'm1', bettor_id: 'u3', pick_player_id: 'p1', stake_coins: 100, status: 'pending', payout_coins: null }),
      { onConflict: 'match_id,bettor_id' },
    )
  })

  it('refunds the previous stake before charging the new one when changing an existing wager', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(0)
    const { admin } = fakeAdmin({ match: openMatch, existing: { id: 'w1', stake_coins: 100 } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 150 })
    expect(result).toEqual({ ok: true })
    expect(recordCoinTransaction).toHaveBeenNthCalledWith(1, admin, 'u3', 100, 'wager_refund', 'm1', 'Wager changed — previous stake refunded')
    expect(recordCoinTransaction).toHaveBeenNthCalledWith(2, admin, 'u3', -150, 'wager_stake', 'm1', 'Wager — match m1')
  })

  it('auto-reverses the debit when the upsert fails', async () => {
    vi.mocked(assertNotPendingDeletion).mockResolvedValue(null)
    vi.mocked(getCoinBalance).mockResolvedValue(200)
    const { admin } = fakeAdmin({ match: openMatch, upsertError: { message: 'db down' } })
    const result = await performPlaceWager({} as never, admin, 'u3', 'm1', { pickPlayerId: 'p1', stakeCoins: 100 })
    expect(result).toEqual({ ok: false, errorCode: 'wager_failed' })
    expect(recordCoinTransaction).toHaveBeenLastCalledWith(admin, 'u3', 100, 'wager_refund', 'm1', 'Wager save failed — auto-reversed')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/wagers/place-wager-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Extracted from `placeWager` in `lib/wagers/actions.ts`, every branch preserved including the previous-stake refund and auto-reversal-on-failure logic. `matchId` is now a parameter (from the path), not read out of the input like the web form's hidden field — `pickPlayerId`/`stakeCoins` still validated via the same `placeWagerSchema`, minus its `matchId` field (the service takes `matchId` as its own argument instead of parsing it from `input`):

```typescript
// lib/wagers/place-wager-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { getCoinBalance, recordCoinTransaction } from '@/lib/coins/service'
import { wagerWindowOpen } from './market'
import { assertNotPendingDeletion } from '@/lib/settings/restriction'

type Admin = ReturnType<typeof createAdminClient>

export type PlaceWagerErrorCode =
  | 'pending_deletion' | 'match_not_found' | 'own_match' | 'invalid_pick' | 'window_closed' | 'insufficient_coins' | 'wager_failed'
export type PlaceWagerResult = { ok: true } | { ok: false; errorCode: PlaceWagerErrorCode }

export async function performPlaceWager(
  supabase: SupabaseClient<Database>,
  admin: Admin,
  userId: string,
  matchId: string,
  input: { pickPlayerId: string; stakeCoins: number },
): Promise<PlaceWagerResult> {
  const restricted = await assertNotPendingDeletion(admin, userId)
  if (restricted) return { ok: false, errorCode: 'pending_deletion' }

  const { data: match } = await admin
    .from('matches')
    .select('id, status, scheduled_at, player_a_id, player_b_id, is_full_day')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return { ok: false, errorCode: 'match_not_found' }
  if (userId === match.player_a_id || userId === match.player_b_id) return { ok: false, errorCode: 'own_match' }
  if (input.pickPlayerId !== match.player_a_id && input.pickPlayerId !== match.player_b_id) return { ok: false, errorCode: 'invalid_pick' }
  if (!wagerWindowOpen(match)) return { ok: false, errorCode: 'window_closed' }

  const { data: existing } = await admin
    .from('match_wagers')
    .select('id, stake_coins')
    .eq('match_id', matchId)
    .eq('bettor_id', userId)
    .maybeSingle()

  const previousStake = existing?.stake_coins ?? 0
  const balance = await getCoinBalance(admin, userId)
  if (balance + previousStake < input.stakeCoins) return { ok: false, errorCode: 'insufficient_coins' }

  if (previousStake > 0) {
    await recordCoinTransaction(admin, userId, previousStake, 'wager_refund', matchId, 'Wager changed — previous stake refunded')
  }
  await recordCoinTransaction(admin, userId, -input.stakeCoins, 'wager_stake', matchId, `Wager — match ${matchId}`)

  const { error: upsertErr } = await admin.from('match_wagers').upsert(
    {
      match_id: matchId, bettor_id: userId, pick_player_id: input.pickPlayerId,
      stake_coins: input.stakeCoins, status: 'pending', payout_coins: null, updated_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,bettor_id' },
  )
  if (upsertErr) {
    await recordCoinTransaction(admin, userId, input.stakeCoins, 'wager_refund', matchId, 'Wager save failed — auto-reversed')
    return { ok: false, errorCode: 'wager_failed' }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/wagers/place-wager-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service**

In `lib/wagers/actions.ts`, `placeWager` becomes: run `placeWagerSchema.safeParse` on the full FormData (unchanged — still includes `matchId` since the web form's hidden field isn't going away), require login, call `performPlaceWager(supabase, createAdminClient(), user.id, matchId, {pickPlayerId, stakeCoins})`, map `errorCode` to the existing messages (`pending_deletion` → whatever `assertNotPendingDeletion` itself returned as its string — the service already returns that exact string as `restricted`, wire it through unchanged rather than re-deriving a generic message; adjust `PlaceWagerResult`'s `pending_deletion` case to carry the original message if the action's existing behavior depends on its exact wording, or accept a fixed fallback message if it doesn't — check whether any existing test asserts on this specific string before deciding), `match_not_found` → `'Match not found.'`, `own_match` → `'You cannot wager on your own match.'`, `invalid_pick` → `'Pick must be one of the two players in this match.'`, `window_closed` → `'Wagering is closed for this match.'`, `insufficient_coins` → `'Not enough SX Coins for this stake.'`, `wager_failed` → `'Could not place your wager. Please try again.'`, keep the existing `revalidatePath('/matches/${matchId}')` call after success.

Run: `find lib/wagers -iname "actions.test.ts"` first — if it exists, check its `pending_deletion` assertion before finalizing the message-wiring decision above.

- [ ] **Step 6: Write the endpoint's failing test**

`POST /matches/{id}/wager` is `idempotent: true` — same `runIdempotent` pass-through pattern.

```typescript
// lib/mobile-api/endpoints/wager.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performPlaceWager } = vi.hoisted(() => ({ performPlaceWager: vi.fn() }))
vi.mock('@/lib/wagers/place-wager-service', () => ({ performPlaceWager }))

import { wagerEndpoint } from './wager'

const body = { pickPlayerId: 'p1', stakeCoins: 100 }
function postReq() {
  return new Request('https://x.test/api/mobile/v1/matches/m1/wager', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify(body),
  })
}

describe('wagerEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performPlaceWager.mockResolvedValue({ ok: true })
    const res = await wagerEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(performPlaceWager).toHaveBeenCalledWith('sb', 'admin', 'u1', 'm1', body)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps insufficient_coins to a 400', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performPlaceWager.mockResolvedValue({ ok: false, errorCode: 'insufficient_coins' })
    const res = await wagerEndpoint.handler(postReq(), { params: { id: 'm1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('insufficient_coins')
  })
})
```

- [ ] **Step 7: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/wager.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/wager.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performPlaceWager, type PlaceWagerErrorCode } from '@/lib/wagers/place-wager-service'
import { MIN_WAGER_STAKE, MAX_WAGER_STAKE } from '@/lib/wagers/market'

const wagerBody = z.object({
  pickPlayerId: z.string().uuid(),
  stakeCoins: z.number().int().min(MIN_WAGER_STAKE).max(MAX_WAGER_STAKE),
})
const wagerResponse = z.object({ success: z.literal(true) })

const STATUS: Record<PlaceWagerErrorCode, number> = {
  pending_deletion: 403, match_not_found: 404, own_match: 400, invalid_pick: 400,
  window_closed: 409, insufficient_coins: 400, wager_failed: 500,
}
const MESSAGE: Record<PlaceWagerErrorCode, string> = {
  pending_deletion: 'Your account is pending deletion.',
  match_not_found: 'Match not found.',
  own_match: 'You cannot wager on your own match.',
  invalid_pick: 'Pick must be one of the two players in this match.',
  window_closed: 'Wagering is closed for this match.',
  insufficient_coins: 'Not enough SX Coins for this stake.',
  wager_failed: 'Could not place your wager. Please try again.',
}

export const wagerEndpoint = defineEndpoint({
  operationId: 'postMatchWager',
  method: 'POST',
  path: '/matches/{id}/wager',
  summary: 'Place or change a coin wager on a match you are not playing in.',
  auth: 'user',
  idempotent: true,
  body: wagerBody,
  response: wagerResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performPlaceWager(ctx.userClient, ctx.admin, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/wager.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the route and registry**

`app/api/mobile/v1/matches/[id]/wager/route.ts`:

```typescript
import { wagerEndpoint } from '@/lib/mobile-api/endpoints/wager'

export const POST = wagerEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `wagerEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/wagers/place-wager-service.ts lib/wagers/place-wager-service.test.ts lib/wagers/actions.ts lib/mobile-api/endpoints/wager.ts lib/mobile-api/endpoints/wager.test.ts app/api/mobile/v1/matches/[id]/wager/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /matches/{id}/wager"
```

---

### Task 12: `POST /lobbies/{id}/result`

**Files:**
- Create: `lib/tournaments/submit-lobby-result-service.ts`
- Create: `lib/tournaments/submit-lobby-result-service.test.ts`
- Modify: `lib/tournaments/lobby-result-actions.ts` (thin wrapper)
- Create: `lib/mobile-api/endpoints/lobby-result.ts`
- Create: `lib/mobile-api/endpoints/lobby-result.test.ts`
- Create: `app/api/mobile/v1/lobbies/[id]/result/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `lobbyResultSchema` (`@/lib/tournaments/lobby-result-schema`), `notifyStaff`/`resultNotification` — reused unmodified. `callerEntrantFor` (the private helper resolving which entrant the caller is) moves into the new service file too, since it is only ever called from inside `submitLobbyResult` today and has no other caller to keep behind in `lobby-result-actions.ts`.
- Produces: `performSubmitLobbyResult(admin, userId, lobbyId, input: {placement, kills, screenshotPath}) => Promise<{ok: true} | {ok: false, errorCode: SubmitLobbyResultErrorCode}>`, `SubmitLobbyResultErrorCode = 'not_in_lobby' | 'lobby_confirmed' | 'validation_failed' | 'result_confirmed' | 'screenshot_required' | 'submit_failed'`.

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/tournaments/submit-lobby-result-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { performSubmitLobbyResult } from './submit-lobby-result-service'

vi.mock('@/lib/admin/staff', () => ({ notifyStaff: vi.fn() }))

function fakeAdmin(opts: {
  callerRow?: Record<string, unknown> | null
  existing?: { id: string; status: string; screenshot_url: string | null } | null
  priorCount?: number
  upsertError?: unknown
}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null })
  const update = vi.fn().mockResolvedValue({ error: null })
  const admin = {
    from: (table: string) => {
      if (table === 'lobby_entrants') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.callerRow ?? null }) }) }) }) }
      if (table === 'lobby_results') {
        return {
          select: (_c: string, meta?: { count?: string; head?: boolean }) =>
            meta?.count
              ? { eq: () => Promise.resolve({ count: opts.priorCount ?? 0 }) }
              : { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }) },
          upsert,
        }
      }
      if (table === 'tournament_lobbies') return { update: () => ({ eq: update }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, upsert, update }
}

const callerRow = {
  entrant_id: 'e1',
  tournament_entrants: { tournament_id: 't1', tournaments: { title: 'Cup' } },
  tournament_lobbies: { status: 'scheduled', stage_id: 's1' },
}
const input = { placement: 3, kills: 5, screenshotPath: 'shots/1.png' }

describe('performSubmitLobbyResult', () => {
  it('reports not_in_lobby when the caller has no entrant row for this lobby', async () => {
    const { admin } = fakeAdmin({ callerRow: null })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'not_in_lobby' })
  })

  it('reports lobby_confirmed once the lobby is locked', async () => {
    const { admin } = fakeAdmin({ callerRow: { ...callerRow, tournament_lobbies: { status: 'confirmed', stage_id: 's1' } } })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'lobby_confirmed' })
  })

  it('reports validation_failed for placement out of range', async () => {
    const { admin } = fakeAdmin({ callerRow })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', { ...input, placement: 0 })
    expect(result).toEqual({ ok: false, errorCode: 'validation_failed' })
  })

  it('reports result_confirmed when the caller already has a confirmed result', async () => {
    const { admin } = fakeAdmin({ callerRow, existing: { id: 'r1', status: 'confirmed', screenshot_url: 'old.png' } })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'result_confirmed' })
  })

  it('reports screenshot_required when neither a new nor an existing screenshot exists', async () => {
    const { admin } = fakeAdmin({ callerRow })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', { ...input, screenshotPath: '' })
    expect(result).toEqual({ ok: false, errorCode: 'screenshot_required' })
  })

  it('upserts placement/kills at zero points and returns ok with the tournamentId, bumping a scheduled lobby to awaiting_results', async () => {
    const { admin, upsert, update } = fakeAdmin({ callerRow })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: true, tournamentId: 't1' })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ lobby_id: 'lob1', entrant_id: 'e1', placement: 3, kills: 5, placement_points: 0, kill_points: 0, status: 'pending' }),
      { onConflict: 'lobby_id,entrant_id' },
    )
    expect(update).toHaveBeenCalled()
  })

  it('does not re-bump the lobby status when it is already awaiting_results', async () => {
    const { admin, update } = fakeAdmin({ callerRow: { ...callerRow, tournament_lobbies: { status: 'awaiting_results', stage_id: 's1' } } })
    await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(update).not.toHaveBeenCalled()
  })

  it('reports submit_failed when the upsert errors', async () => {
    const { admin } = fakeAdmin({ callerRow, upsertError: { message: 'db down' } })
    const result = await performSubmitLobbyResult(admin, 'u1', 'lob1', input)
    expect(result).toEqual({ ok: false, errorCode: 'submit_failed' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tournaments/submit-lobby-result-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Extracted from `submitLobbyResult` (and its private `callerEntrantFor` helper) in `lib/tournaments/lobby-result-actions.ts` — every branch preserved, including "points written at confirm time, never here" and the staff-notify-once-per-lobby gate:

```typescript
// lib/tournaments/submit-lobby-result-service.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'
import { resultNotification } from '@/lib/admin/notification-copy'
import { lobbyResultSchema } from './lobby-result-schema'

type Admin = ReturnType<typeof createAdminClient>

export type SubmitLobbyResultErrorCode =
  | 'not_in_lobby' | 'lobby_confirmed' | 'validation_failed' | 'result_confirmed' | 'screenshot_required' | 'submit_failed'
export type SubmitLobbyResultResult =
  | { ok: true; tournamentId: string }
  | { ok: false; errorCode: SubmitLobbyResultErrorCode }

interface CallerEntrant {
  entrantId: string
  lobbyStatus: string
  stageId: string
  tournamentId: string
  tournamentTitle: string
}

async function callerEntrantFor(admin: Admin, lobbyId: string, userId: string): Promise<CallerEntrant | null> {
  const { data: raw } = await admin
    .from('lobby_entrants')
    .select(
      'entrant_id, ' +
        'tournament_entrants!inner(player_id, tournament_id, tournaments(title)), ' +
        'tournament_lobbies!inner(status, stage_id)',
    )
    .eq('lobby_id', lobbyId)
    .eq('tournament_entrants.player_id', userId)
    .maybeSingle()
  if (!raw) return null

  const r = raw as unknown as {
    entrant_id: string
    tournament_entrants:
      | { tournament_id: string; tournaments: { title: string } | { title: string }[] | null }
      | { tournament_id: string; tournaments: { title: string } | { title: string }[] | null }[]
    tournament_lobbies: { status: string; stage_id: string } | { status: string; stage_id: string }[]
  }
  const ent = Array.isArray(r.tournament_entrants) ? r.tournament_entrants[0] : r.tournament_entrants
  const lob = Array.isArray(r.tournament_lobbies) ? r.tournament_lobbies[0] : r.tournament_lobbies
  const tRef = Array.isArray(ent?.tournaments) ? ent.tournaments[0] : ent?.tournaments

  return {
    entrantId: r.entrant_id,
    lobbyStatus: lob?.status ?? 'scheduled',
    stageId: lob?.stage_id ?? '',
    tournamentId: ent?.tournament_id ?? '',
    tournamentTitle: tRef?.title ?? 'Tournament',
  }
}

export async function performSubmitLobbyResult(
  admin: Admin,
  userId: string,
  lobbyId: string,
  input: { placement: number; kills: number; screenshotPath: string },
): Promise<SubmitLobbyResultResult> {
  const caller = await callerEntrantFor(admin, lobbyId, userId)
  if (!caller) return { ok: false, errorCode: 'not_in_lobby' }
  if (caller.lobbyStatus === 'confirmed') return { ok: false, errorCode: 'lobby_confirmed' }

  const parsed = lobbyResultSchema.safeParse({ placement: input.placement, kills: input.kills })
  if (!parsed.success) return { ok: false, errorCode: 'validation_failed' }

  const { data: existing } = await admin
    .from('lobby_results')
    .select('id, status, screenshot_url')
    .eq('lobby_id', lobbyId)
    .eq('entrant_id', caller.entrantId)
    .maybeSingle()
  if (existing?.status === 'confirmed') return { ok: false, errorCode: 'result_confirmed' }

  const finalScreenshot = input.screenshotPath || existing?.screenshot_url || null
  if (!finalScreenshot) return { ok: false, errorCode: 'screenshot_required' }

  const { count: priorSubmissions } = await admin
    .from('lobby_results')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId)

  const { error } = await admin.from('lobby_results').upsert(
    {
      lobby_id: lobbyId, entrant_id: caller.entrantId, placement: parsed.data.placement, kills: parsed.data.kills,
      placement_points: 0, kill_points: 0, screenshot_url: finalScreenshot, submitted_by: userId, status: 'pending',
    },
    { onConflict: 'lobby_id,entrant_id' },
  )
  if (error) return { ok: false, errorCode: 'submit_failed' }

  if (caller.lobbyStatus === 'scheduled') {
    await admin.from('tournament_lobbies').update({ status: 'awaiting_results' }).eq('id', lobbyId)
  }

  if (!priorSubmissions) {
    const notification = resultNotification({
      type: 'result_needs_review', tournamentTitle: caller.tournamentTitle,
      playerAName: 'Lobby', playerBName: 'results', createdAt: new Date().toISOString(),
    })
    await notifyStaff(admin, 'result_needs_review', {
      title: notification.title,
      body: `${caller.tournamentTitle} — a lobby has results to review.`,
      link: `/admin/tournaments/${caller.tournamentId}/lobbies`,
    })
  }

  return { ok: true, tournamentId: caller.tournamentId }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tournaments/submit-lobby-result-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the Server Action to call the new service**

In `lib/tournaments/lobby-result-actions.ts`, `submitLobbyResult` becomes: parse `lobbyId`/`screenshotPath` from `formData`, require login, call `performSubmitLobbyResult(createAdminClient(), user.id, lobbyId, {placement: formData.get('placement'), kills: formData.get('kills'), screenshotPath})` (the service's own `lobbyResultSchema.safeParse` handles coercion from the raw FormData values, same reasoning as Task 9's result-submission wrapper), map `errorCode` to the existing messages (`not_in_lobby` → `'You are not in this lobby.'`, `lobby_confirmed` → `'This lobby has been confirmed and can no longer be edited.'`, `validation_failed` → the original `parsed.error.issues[0].message` — same fidelity trade-off note as Task 9 applies here too, check for an existing `lobby-result-actions.test.ts` before deciding, `result_confirmed` → `'Your result is confirmed and can no longer be edited.'`, `screenshot_required` → `'A screenshot is required.'`, `submit_failed` → `'Could not submit your result. Please try again.'`), keep the existing `revalidatePath('/lobbies/${lobbyId}')` and `revalidatePath('/admin/tournaments/${result.tournamentId}/lobbies')` calls after success — `SubmitLobbyResultResult`'s `{ok: true}` branch now carries `tournamentId` (Step 3 above), so the wrapper reads it straight off the service's return rather than re-deriving it with a second lookup.

Run: `find lib/tournaments -iname "lobby-result-actions.test.ts"` first to check any existing message assertions before finalizing.

Also verify `frozenResultRows`/`stageIsComplete`/`validateLobbyResults`/`parsePointsConfig`/`DEFAULT_POINTS_CONFIG` (imported at the top of the original `lobby-result-actions.ts` file) are still used elsewhere in that file after this extraction — `submitLobbyResult` itself doesn't reference them (confirmed: they're used by `confirmLobby`/`disputeLobbyResult`, the two other exports in that file, untouched by this task) — do not remove those imports.

- [ ] **Step 6: Write the endpoint's failing test**

`POST /lobbies/{id}/result` is `idempotent: true` — same `runIdempotent` pass-through pattern.

```typescript
// lib/mobile-api/endpoints/lobby-result.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { performSubmitLobbyResult } = vi.hoisted(() => ({ performSubmitLobbyResult: vi.fn() }))
vi.mock('@/lib/tournaments/submit-lobby-result-service', () => ({ performSubmitLobbyResult }))

import { lobbyResultEndpoint } from './lobby-result'

const body = { placement: 3, kills: 5, screenshotPath: 'shots/1.png' }
function postReq() {
  return new Request('https://x.test/api/mobile/v1/lobbies/lob1/result', {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify(body),
  })
}

describe('lobbyResultEndpoint', () => {
  it('returns {success: true} on success', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitLobbyResult.mockResolvedValue({ ok: true, tournamentId: 't1' })
    const res = await lobbyResultEndpoint.handler(postReq(), { params: { id: 'lob1' } })
    expect(performSubmitLobbyResult).toHaveBeenCalledWith('admin', 'u1', 'lob1', body)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ success: true })
  })

  it('maps lobby_confirmed to a 409', async () => {
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    runIdempotent.mockImplementation(async (_admin, _args, run) => run())
    performSubmitLobbyResult.mockResolvedValue({ ok: false, errorCode: 'lobby_confirmed' })
    const res = await lobbyResultEndpoint.handler(postReq(), { params: { id: 'lob1' } })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('lobby_confirmed')
  })
})
```

- [ ] **Step 7: Run to verify it fails, then write the endpoint**

Run: `npx vitest run lib/mobile-api/endpoints/lobby-result.test.ts` — expect FAIL, module doesn't exist.

```typescript
// lib/mobile-api/endpoints/lobby-result.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performSubmitLobbyResult, type SubmitLobbyResultErrorCode } from '@/lib/tournaments/submit-lobby-result-service'

const lobbyResultBody = z.object({
  placement: z.number().int().min(1).max(100),
  kills: z.number().int().min(0).max(100),
  screenshotPath: z.string(),
})
const lobbyResultResponse = z.object({ success: z.literal(true) })

const STATUS: Record<SubmitLobbyResultErrorCode, number> = {
  not_in_lobby: 403, lobby_confirmed: 409, validation_failed: 400, result_confirmed: 409, screenshot_required: 400, submit_failed: 500,
}
const MESSAGE: Record<SubmitLobbyResultErrorCode, string> = {
  not_in_lobby: 'You are not in this lobby.',
  lobby_confirmed: 'This lobby has been confirmed and can no longer be edited.',
  validation_failed: 'Please check your placement and kills.',
  result_confirmed: 'Your result is confirmed and can no longer be edited.',
  screenshot_required: 'A screenshot is required.',
  submit_failed: 'Could not submit your result. Please try again.',
}

export const lobbyResultEndpoint = defineEndpoint({
  operationId: 'postLobbyResult',
  method: 'POST',
  path: '/lobbies/{id}/result',
  summary: 'Submit a placement/kills result for one lobby (BR/points-race formats) for admin review.',
  auth: 'user',
  idempotent: true,
  body: lobbyResultBody,
  response: lobbyResultResponse,
  handler: async ({ ctx, body, params }) => {
    const result = await performSubmitLobbyResult(ctx.admin, ctx.userId, params.id, body)
    if (!result.ok) throw new ApiError(STATUS[result.errorCode], result.errorCode, MESSAGE[result.errorCode])
    return { success: true as const }
  },
})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/lobby-result.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the route and registry**

`app/api/mobile/v1/lobbies/[id]/result/route.ts`:

```typescript
import { lobbyResultEndpoint } from '@/lib/mobile-api/endpoints/lobby-result'

export const POST = lobbyResultEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `lobbyResultEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add lib/tournaments/submit-lobby-result-service.ts lib/tournaments/submit-lobby-result-service.test.ts lib/tournaments/lobby-result-actions.ts lib/mobile-api/endpoints/lobby-result.ts lib/mobile-api/endpoints/lobby-result.test.ts app/api/mobile/v1/lobbies/[id]/result/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add POST /lobbies/{id}/result"
```

---

### Task 13: `GET /me/summary`

**Files:**
- Create: `lib/dashboard/summary-service.ts`
- Create: `lib/dashboard/summary-service.test.ts`
- Create: `lib/mobile-api/endpoints/summary.ts`
- Create: `lib/mobile-api/endpoints/summary.test.ts`
- Create: `app/api/mobile/v1/me/summary/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `bucketFixtures`/`isTournamentPublished` (`@/lib/dashboard/fixtures`), `fetchNextLobby` (`@/lib/tournaments/next-lobby`), `computeTournamentStatus` (`@/lib/dashboard/tournament-status`) — all reused unmodified, pure/composable functions already used by the three existing dashboard pages this endpoint condenses.
- Produces: `buildMeSummary(supabase, userId) => Promise<MeSummary>` — always succeeds for a valid `userId` (no not-found branch; a brand-new player with nothing yet just gets empty arrays/nulls throughout, matching what the three source pages already do for that case).

**Scope, from spec §7:** next fixture + countdown, active registrations, submit-result prompt, qualify/eliminate banners. **Explicitly excluded**, matching the spec: streak, quests, wallet/coin tiles — do not add fields for these even though the source `/dashboard` page's fetch block includes them.

**This condenses three existing pages' composition logic**, not one:
- Next fixture + submit-result prompt: `app/[locale]/dashboard/page.tsx`'s `nextMatchRes`/`fetchNextLobby`/`myOpenMatchesRes`/`bucketFixtures` block.
- Active registrations: `app/[locale]/dashboard/tournaments/page.tsx`'s `tournament_registrations` query.
- Qualify/eliminate banners: `app/[locale]/dashboard/matches/page.tsx`'s group-membership + knockout-match + `computeTournamentStatus` loop (lines ~46-196 of that file).

- [ ] **Step 1: Write the failing tests**

```typescript
// lib/dashboard/summary-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildMeSummary } from './summary-service'

vi.mock('@/lib/tournaments/next-lobby', () => ({ fetchNextLobby: vi.fn().mockResolvedValue(null) }))

function fakeSupabase(opts: {
  nextMatch?: Record<string, unknown>[]
  resultsRows?: { match_id: string }[]
  openMatches?: { id: string; status: string; scheduled_at: string | null }[]
  registrations?: Record<string, unknown>[]
  groupMemberships?: Record<string, unknown>[]
  visibleMatches?: Record<string, unknown>[]
}) {
  return {
    from: (table: string) => {
      if (table === 'matches') {
        return {
          select: (cols: string) => {
            if (cols.includes('opponent_a')) return { or: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: opts.nextMatch ?? [] }) }) }) }) }
            if (cols.includes('player_a:profiles')) return { or: () => Promise.resolve({ data: opts.visibleMatches ?? [] }) }
            return { or: () => ({ in: () => Promise.resolve({ data: opts.openMatches ?? [] }) }) }
          },
        }
      }
      if (table === 'match_results') return { select: () => ({ eq: () => Promise.resolve({ data: opts.resultsRows ?? [] }) }) }
      if (table === 'tournament_registrations') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: opts.registrations ?? [] }) }) }) }
      if (table === 'group_memberships') return { select: () => ({ eq: () => Promise.resolve({ data: opts.groupMemberships ?? [] }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

describe('buildMeSummary', () => {
  it('returns nulls/empty arrays for a player with nothing yet', async () => {
    const result = await buildMeSummary(fakeSupabase({}), 'u1')
    expect(result).toEqual({ nextMatch: null, nextLobby: null, hasSubmittableMatch: false, registrations: [], banners: [] })
  })

  it('reports hasSubmittableMatch when a live fixture has no submission yet', async () => {
    const result = await buildMeSummary(
      fakeSupabase({ openMatches: [{ id: 'm1', status: 'live', scheduled_at: new Date().toISOString() }] }),
      'u1',
    )
    expect(result.hasSubmittableMatch).toBe(true)
  })

  it('maps registration rows to the summary shape', async () => {
    const result = await buildMeSummary(
      fakeSupabase({
        registrations: [{ id: 'r1', payment_status: 'paid', tournament: { title: 'Cup', slug: 'cup', status: 'active' } }],
      }),
      'u1',
    )
    expect(result.registrations).toEqual([{ id: 'r1', paymentStatus: 'paid', tournamentTitle: 'Cup', tournamentSlug: 'cup' }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dashboard/summary-service.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/dashboard/summary-service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { bucketFixtures, isTournamentPublished, type DashboardMatchInput } from './fixtures'
import { fetchNextLobby, type NextLobby } from '@/lib/tournaments/next-lobby'
import { computeTournamentStatus, type KnockoutMatchInput, type TournamentBanner } from './tournament-status'
import type { MembershipInput } from '@/lib/tournaments/standings'

export interface MeSummaryNextMatch {
  id: string; status: string; round: string; scheduledAt: string | null; isFullDay: boolean; tournamentTitle: string
}
export interface MeSummaryRegistration {
  id: string; paymentStatus: string; tournamentTitle: string; tournamentSlug: string
}
export interface MeSummary {
  nextMatch: MeSummaryNextMatch | null
  nextLobby: NextLobby | null
  hasSubmittableMatch: boolean
  registrations: MeSummaryRegistration[]
  banners: NonNullable<TournamentBanner>[]
}

type TournamentRef = { title: string; slug: string; status: string } | { title: string; slug: string; status: string }[] | null
function firstTournament(t: TournamentRef) {
  return Array.isArray(t) ? t[0] ?? null : t
}

export async function buildMeSummary(supabase: SupabaseClient<Database>, userId: string): Promise<MeSummary> {
  const [nextMatchRes, resultsRes, openMatchesRes, registrationsRes, groupMembershipsRes, visibleMatchesRes, nextLobby] =
    await Promise.all([
      supabase
        .from('matches')
        .select('id, status, round, scheduled_at, is_full_day, tournament:tournaments(title), opponent_a:profiles!matches_player_a_id_fkey(id), opponent_b:profiles!matches_player_b_id_fkey(id)')
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1),
      supabase.from('match_results').select('match_id').eq('submitted_by', userId),
      supabase
        .from('matches')
        .select('id, status, scheduled_at')
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`)
        .in('status', ['scheduled', 'live']),
      supabase
        .from('tournament_registrations')
        .select('id, payment_status, tournament:tournaments(title, slug, status)')
        .eq('player_id', userId)
        .order('registered_at', { ascending: false }),
      supabase.from('group_memberships').select('group_id, groups(tournament_id)').eq('player_id', userId),
      supabase
        .from('matches')
        .select('id, round, status, score_a, score_b, tournament_id, player_a_id, player_b_id, tournament:tournaments(title, slug, status)')
        .or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`),
      fetchNextLobby(userId),
    ])

  const submittedMatchIds = new Set((resultsRes.data ?? []).map((r) => r.match_id))

  const nextRaw = (nextMatchRes.data as unknown[] | null)?.[0] as
    | { id: string; status: string; round: string; scheduled_at: string | null; is_full_day: boolean; tournament: TournamentRef }
    | undefined
  const nextMatch: MeSummaryNextMatch | null = nextRaw
    ? {
        id: nextRaw.id, status: nextRaw.status, round: nextRaw.round, scheduledAt: nextRaw.scheduled_at,
        isFullDay: nextRaw.is_full_day, tournamentTitle: firstTournament(nextRaw.tournament)?.title ?? 'Tournament',
      }
    : null

  const openMatches: DashboardMatchInput[] = (openMatchesRes.data ?? []).map((m) => ({
    id: m.id, status: m.status, scheduledAt: m.scheduled_at, isFullDay: false, round: '',
    opponentName: '', tournamentTitle: '', tournamentSlug: '',
  }))
  const openFixtures = bucketFixtures(openMatches, submittedMatchIds, new Date())
  const hasSubmittableMatch = openFixtures.live.length > 0 || openFixtures.upcoming.some((f) => f.awaitingMyResult)

  const registrations: MeSummaryRegistration[] = ((registrationsRes.data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as { id: string; payment_status: string; tournament: TournamentRef }
    const t = firstTournament(r.tournament)
    return { id: r.id, paymentStatus: r.payment_status, tournamentTitle: t?.title ?? 'Tournament', tournamentSlug: t?.slug ?? '' }
  })

  // Qualify/eliminate banners — condensed from dashboard/matches/page.tsx's
  // group-membership + knockout-match composition (that page's lines ~46-196).
  type GroupTournamentRef = { tournament_id: string } | { tournament_id: string }[] | null
  const myGroupRows = ((groupMembershipsRes.data as unknown[] | null) ?? []) as { group_id: string; groups: GroupTournamentRef }[]
  const groupIdByTournamentId = new Map<string, string>()
  for (const r of myGroupRows) {
    const row = Array.isArray(r.groups) ? r.groups[0] ?? null : r.groups
    if (row?.tournament_id) groupIdByTournamentId.set(row.tournament_id, r.group_id)
  }
  const myGroupIds = Array.from(new Set(myGroupRows.map((r) => r.group_id)))

  const [groupStandingsRes, groupMatchesRes] =
    myGroupIds.length > 0
      ? await Promise.all([
          supabase.from('group_memberships').select('group_id, player_id, wins, draws, losses, goals_for, goals_against, points').in('group_id', myGroupIds),
          supabase.from('matches').select('group_id, status').in('group_id', myGroupIds).eq('round', 'group'),
        ])
      : [{ data: [] as { group_id: string; player_id: string | null; wins: number; draws: number; losses: number; goals_for: number; goals_against: number; points: number }[] }, { data: [] as { group_id: string; status: string }[] }]

  const groupCompleteById = new Map<string, boolean>()
  const groupStandingsById = new Map<string, MembershipInput[]>()
  for (const groupId of myGroupIds) {
    const matchRows = (groupMatchesRes.data ?? []).filter((m) => m.group_id === groupId)
    groupCompleteById.set(groupId, matchRows.length > 0 && matchRows.every((m) => m.status === 'completed'))
    groupStandingsById.set(
      groupId,
      (groupStandingsRes.data ?? [])
        .filter((r) => r.group_id === groupId && r.player_id != null)
        .map((r) => ({ playerId: r.player_id as string, name: '', wins: r.wins, draws: r.draws, losses: r.losses, goalsFor: r.goals_for, goalsAgainst: r.goals_against, points: r.points })),
    )
  }

  type VisibleMatchRow = { id: string; round: string; status: string; score_a: number | null; score_b: number | null; tournament_id: string; player_a_id: string | null; player_b_id: string | null; tournament: TournamentRef }
  const visibleMatches = ((visibleMatchesRes.data as unknown[] | null) ?? []) as VisibleMatchRow[]
  const knockoutMatchesByTournament = new Map<string, KnockoutMatchInput[]>()
  const tournamentRefById = new Map<string, { title: string; slug: string; status: string }>()
  for (const mm of visibleMatches) {
    const t = firstTournament(mm.tournament)
    if (t) tournamentRefById.set(mm.tournament_id, t)
    if (mm.round === 'group' || !t || !isTournamentPublished(t.status)) continue
    const list = knockoutMatchesByTournament.get(mm.tournament_id) ?? []
    list.push({ round: mm.round, status: mm.status, score_a: mm.score_a, score_b: mm.score_b, player_a_id: mm.player_a_id, player_b_id: mm.player_b_id })
    knockoutMatchesByTournament.set(mm.tournament_id, list)
  }

  const tournamentIdsToEvaluate = Array.from(new Set([...knockoutMatchesByTournament.keys(), ...groupIdByTournamentId.keys()]))
  const banners: NonNullable<TournamentBanner>[] = []
  for (const tournamentId of tournamentIdsToEvaluate) {
    const ref = tournamentRefById.get(tournamentId)
    if (!ref || !isTournamentPublished(ref.status)) continue
    const groupId = groupIdByTournamentId.get(tournamentId) ?? null
    const banner = computeTournamentStatus(userId, {
      tournamentId, tournamentTitle: ref.title, tournamentSlug: ref.slug, tournamentStatus: ref.status,
      groupId, groupComplete: groupId ? groupCompleteById.get(groupId) ?? false : false,
      groupStandings: groupId ? groupStandingsById.get(groupId) ?? [] : [],
      knockoutMatches: knockoutMatchesByTournament.get(tournamentId) ?? [],
    })
    if (banner) banners.push(banner)
  }

  return { nextMatch, nextLobby, hasSubmittableMatch, registrations, banners }
}
```

`fetchNextLobby`'s real return type is `NextLobbyData | null` (imported from `@/components/dashboard/NextLobbyCard` inside `lib/tournaments/next-lobby.ts`), with the exact shape `{lobbyId: string, tournamentTitle: string, stageName: string, roundNo: number, label: string, scheduledAt: string | null, hasRoomCode: boolean, submitted: boolean}` — read directly off `fetchNextLobby`'s own return statement (`lib/tournaments/next-lobby.ts:69-78`), used verbatim in Step 5's `MeSummary.nextLobby` field type (replace the `NextLobby` import above with `NextLobbyData` from the same package, or re-declare the same shape locally — either is fine since the component-file import has no client-only dependency that would make importing it from a `lib/` service file wrong, but confirm `NextLobbyCard.tsx` doesn't import anything React-specific at module scope before doing so; if it does, redeclare the interface locally in `summary-service.ts` instead of importing it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dashboard/summary-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the endpoint**

Read `lib/tournaments/next-lobby.ts` and `lib/dashboard/tournament-status.ts`'s `TournamentBanner` union (already shown in full during spec research, §6 of the design work above) to build accurate zod schemas for `nextLobby` and `banners` — do not guess `NextLobby`'s shape; the `TournamentBanner` union is already known exactly (`{kind: 'qualified', tournamentTitle, tournamentSlug, round, awaitingOpponent} | {kind: 'eliminated', tournamentTitle, tournamentSlug, round}`).

```typescript
// lib/mobile-api/endpoints/summary.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { buildMeSummary } from '@/lib/dashboard/summary-service'

const nextMatch = z.object({
  id: z.string(), status: z.string(), round: z.string(), scheduledAt: z.string().nullable(),
  isFullDay: z.boolean(), tournamentTitle: z.string(),
}).nullable()

const banner = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('qualified'), tournamentTitle: z.string(), tournamentSlug: z.string(), round: z.string(), awaitingOpponent: z.boolean() }),
  z.object({ kind: z.literal('eliminated'), tournamentTitle: z.string(), tournamentSlug: z.string(), round: z.string() }),
])

const registration = z.object({ id: z.string(), paymentStatus: z.string(), tournamentTitle: z.string(), tournamentSlug: z.string() })

const nextLobby = z.object({
  lobbyId: z.string(), tournamentTitle: z.string(), stageName: z.string(), roundNo: z.number(),
  label: z.string(), scheduledAt: z.string().nullable(), hasRoomCode: z.boolean(), submitted: z.boolean(),
}).nullable()

const summaryResponse = z.object({
  nextMatch,
  nextLobby,
  hasSubmittableMatch: z.boolean(),
  registrations: z.array(registration),
  banners: z.array(banner),
})

export const summaryEndpoint = defineEndpoint({
  operationId: 'getMeSummary',
  method: 'GET',
  path: '/me/summary',
  summary: 'Dashboard fixtures summary: next fixture, submit-result prompt, active registrations, qualify/eliminate banners.',
  auth: 'user',
  response: summaryResponse,
  handler: async ({ ctx }) => buildMeSummary(ctx.userClient, ctx.userId),
})
```

- [ ] **Step 6: Write the endpoint's test**

```typescript
// lib/mobile-api/endpoints/summary.test.ts
import { describe, it, expect, vi } from 'vitest'

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth: vi.fn() }))
const { buildMeSummary } = vi.hoisted(() => ({ buildMeSummary: vi.fn() }))
vi.mock('@/lib/dashboard/summary-service', () => ({ buildMeSummary }))

import { summaryEndpoint } from './summary'

function getReq() {
  return new Request('https://x.test/api/mobile/v1/me/summary')
}

describe('summaryEndpoint', () => {
  it('calls buildMeSummary with the caller and returns its result', async () => {
    const summary = { nextMatch: null, nextLobby: null, hasSubmittableMatch: false, registrations: [], banners: [] }
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    buildMeSummary.mockResolvedValue(summary)
    const res = await summaryEndpoint.handler(getReq(), { params: {} })
    expect(buildMeSummary).toHaveBeenCalledWith('sb', 'u1')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(summary)
  })

  it('accepts a populated nextLobby in the response', async () => {
    const summary = {
      nextMatch: null,
      nextLobby: { lobbyId: 'l1', tournamentTitle: 'Cup', stageName: 'Stage 1', roundNo: 1, label: 'Round 1', scheduledAt: null, hasRoomCode: true, submitted: false },
      hasSubmittableMatch: false, registrations: [], banners: [],
    }
    authenticate.mockResolvedValue({ userId: 'u1', admin: 'admin', userClient: 'sb' })
    buildMeSummary.mockResolvedValue(summary)
    const res = await summaryEndpoint.handler(getReq(), { params: {} })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(summary)
  })
})
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run lib/mobile-api/endpoints/summary.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the route and registry**

`app/api/mobile/v1/me/summary/route.ts`:

```typescript
import { summaryEndpoint } from '@/lib/mobile-api/endpoints/summary'

export const GET = summaryEndpoint.handler
```

In `lib/mobile-api/endpoints/index.ts`, add the import and append `summaryEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add lib/dashboard/summary-service.ts lib/dashboard/summary-service.test.ts lib/mobile-api/endpoints/summary.ts lib/mobile-api/endpoints/summary.test.ts app/api/mobile/v1/me/summary/route.ts lib/mobile-api/endpoints/index.ts
git commit -m "feat(mobile-api): add GET /me/summary"
```

---

### Task 14: Regenerate OpenAPI, prove idempotency end-to-end, final verification

**Files:**
- Modify: `openapi/mobile-v1.json` (generated, not hand-edited)

**Interfaces:** none new — this task verifies everything Tasks 1-13 built.

- [ ] **Step 1: Regenerate the OpenAPI contract**

Run: `npm run openapi`
Expected: succeeds, `openapi/mobile-v1.json` now includes all 12 endpoints added in Tasks 2-13 (`getTournamentBracket`, `getTournamentStandings`, `getTournamentResults`, `postSquads`, `getSquadLookup`, `getMatchCentre`, `postMatchCheckIn`, `postMatchResult`, `postMatchRating`, `postMatchWager`, `postLobbyResult`, `getMeSummary`).

- [ ] **Step 2: Run the full web test suite and typecheck**

Run: `npx tsc --noEmit && npm run test && npm run lint`
Expected: all three clean. (`npm run lint` specifically — per project memory, `next build`'s ESLint pass has caught issues `tsc --noEmit` alone missed before; run it explicitly here rather than discovering a lint failure only on push.)

- [ ] **Step 3: Prove idempotency on staging — sequential replay**

Against a preview deployment on this plan's branch (Task 1's verified staging-pointed environment), using a real bearer token for a staging test account:

1. `POST /matches/{id}/result` with a fresh `Idempotency-Key` header and a valid body → expect `200 {data: {success: true}}`.
2. Repeat the exact same request (same key, same body) → expect the byte-identical response, not merely another `200` — assert the full JSON matches, proving replay rather than re-execution (re-running would still return `{success: true}` even if it had incorrectly re-executed, so this alone doesn't catch a double-run; combine with Step 4's DB check).
3. Query `match_results` on staging directly (via `mcp__claude_ai_Supabase__execute_sql` against `ofxmoxpvwbemfouaowoa`) and confirm exactly one row exists for that `(match_id, submitted_by)` pair — this is what actually proves the second request didn't re-execute the write, not just that it returned the same JSON.
4. Repeat Steps 1-3 for `POST /matches/{id}/rating` (confirm exactly one `opponent_ratings` row and, for a non-3★ rating, exactly one `sx_score_events` row with `event_type = 'rating_received'`), `POST /matches/{id}/wager` (confirm exactly one `match_wagers` row and the coin ledger shows exactly one `wager_stake` transaction, not two), `POST /squads` (confirm exactly one `squads` row for that name), and `POST /lobbies/{id}/result` (confirm exactly one `lobby_results` row).

- [ ] **Step 4: Prove idempotency on staging — concurrent reclaim**

This is the case 2a's own exit criteria (§7 of that plan) required and is not re-proven by Step 3 above — Step 3 only proves sequential replay works, not that a slow original holder's late-arriving fill is correctly discarded after a reclaim. Pick one endpoint (`POST /matches/{id}/result` is the simplest to stage) and reproduce the concurrent-reclaim race directly against `api_idempotency_keys` on staging:

1. Insert a row into `api_idempotency_keys` on staging directly via SQL with `created_at` set to 31 seconds in the past and `completed_at` null (simulating an abandoned claim) — same key/user_id/route a real request would use.
2. Fire a real `POST /matches/{id}/result` request with that same `Idempotency-Key` — this request should reclaim the stale row (per `runIdempotent`'s existing, already-tested logic from 2a — this step is proving the *wiring*, not re-testing `runIdempotent` itself, which already has unit coverage from 2a's Task 2) and complete normally.
3. Query `api_idempotency_keys` on staging directly and confirm `completed_at` is now set and `created_at` has moved to a new (reclaimed) generation, not the original 31-second-old value.

- [ ] **Step 5: Full-loop staging walkthrough**

Exercise the phase's exit criterion (spec §8) end to end on staging: an admin (web) publishes a bracket for a test tournament → a test player account checks in (`POST /matches/{id}/check-in`) → submits a result (`POST /matches/{id}/result`) → admin confirms it on web (unchanged, not part of this plan) → `GET /tournaments/{id}/bracket` reflects the confirmed result → the player rates their opponent (`POST /matches/{id}/rating`) → `GET /me/summary` shows no more submit-result prompt for that match. Record which of these steps were exercised and any deviations found, the same way 2a's plan execution would have logged its own staging walkthrough.

- [ ] **Step 6: Commit the regenerated OpenAPI contract**

```bash
git add openapi/mobile-v1.json
git commit -m "chore(mobile-api): regenerate openapi.json for the 2b endpoints"
```

- [ ] **Step 7: Notify the mobile repo**

Per CLAUDE.md rule 11, the Flutter mobile repo (`sentinelx_mobile`) builds against the committed `openapi/mobile-v1.json` contract — after this plan's final commit lands on `main`, update that repo's pinned copy of the spec (same handoff 2a's own final task performed) so mobile-side Phase 2b implementation can start against the real, shipped contract rather than this plan's draft shapes.

