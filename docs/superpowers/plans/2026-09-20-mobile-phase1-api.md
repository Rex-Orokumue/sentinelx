# Mobile Phase 1 — Web API (auth, session, onboarding, home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `POST /auth/signup`, `POST /auth/resend-confirmation`, `POST /auth/request-reset`, `POST /session/start`, `POST /onboarding/username` and `GET /home` on `/api/mobile/v1`, each backed by the exact same logic the web Server Actions/page already run (extracted into a shared service function, never forked), so the Flutter app in the companion mobile plan can sign a new player up, run the same login side-effects, claim a username, and render Home.

**Architecture:** Per-domain extraction (§7.1 of the master spec): pull each Server Action's/page's core logic into a plain, client-agnostic service function that both the existing Server Action (or page) and a new `defineEndpoint` call, unchanged in behavior. `lib/login/actions.ts`'s `recordDailyLogin` changes from `Promise<void>` to a typed result (still called identically by the one existing call site). No new tables, no new migrations.

**Tech Stack:** Next.js 14 Route Handlers, TypeScript, zod, `@supabase/supabase-js`, Vitest — same as Phase 0B, which this plan builds directly on top of (`lib/mobile-api/{errors,auth,define-endpoint,openapi}.ts`, `lib/mobile-api/endpoints/{config,me,client-errors,devices}.ts` all already shipped on `main`).

**Spec:** `docs/superpowers/specs/2026-09-20-mobile-phase1-auth-shell-home-design.md` (this repo) §2, §3, §5. Background: `docs/superpowers/specs/2026-09-18-flutter-mobile-app-master-design.md` §6.1, §7.1–§7.3, §13 Phase 1 row.

## Global Constraints

- **Work in a fresh git worktree/branch off `origin/main`**, not off any older local branch — `lib/mobile-api/*` (Phase 0B) and the S1–S3 profiles lock-down (Phase 0A) only exist on `origin/main` at plan-writing time; several local branches in this checkout predate both. Use `superpowers:using-git-worktrees`.
- **`profiles` can no longer be written by `anon`/`authenticated`** (S2, migration `20260918200000_lock_down_profiles_and_write_paths.sql`, applied and verified 2026-09-19): every `profiles` UPDATE goes through `createAdminClient()` (service role), never the request-scoped/RLS client. `SELECT` on `profiles` is still allowed for an explicit column allow-list (`id, username, display_name, avatar_url, country, sx_score, total_matches, wins, losses, goals_scored, goals_conceded, total_titles, kyc_verified, created_at, updated_at, bio, phone_verified_at, sentinel_tier, xp, membership_tier, last_login_date, login_streak, username_changed_at, locale, deleted_at, equipped_avatar_border, equipped_bubble_skin`) — every column this plan reads (`username`, `wins`, `total_matches`, `sx_score`, `sentinel_tier`, `membership_tier`, `equipped_avatar_border`, `last_login_date`, `login_streak`, `deletion_requested_at`... **`deletion_requested_at` is NOT in that allow-list** — it is one of the columns S1 made private. `/session/start` must therefore read it via `ctx.admin` (service role), never `ctx.userClient` — same reasoning `GET /me` already uses (`lib/mobile-api/endpoints/me.ts`).
- Auth header `Authorization: Bearer <Supabase access token>`, verified via `supabase.auth.getUser(token)` (network-verified, never decode locally) — already built into `authenticate()`/`defineEndpoint`. Envelope `{data}`/`{error}`; `code` reuses the web's existing `errorCode` strings.
- **No `Idempotency-Key`** on any endpoint in this plan — none of them are repeatable financial/state-creating mutations in the sense §7.2 requires it for (signup is naturally idempotent via `auth.signUp`; session/start and username-claim are themselves idempotent).
- Every new/changed unit test must pass with `npx vitest run <file>`; the full suite (`npm run test`) and `npx tsc --noEmit` must be clean before the final commit of each task.
- After adding an endpoint: `npm run openapi` to regenerate `openapi/mobile-v1.json`, then commit it alongside the endpoint.
- **Testing discipline (spec §5):** every automated test in this plan uses fakes/mocks — no automated test in this repo hits production. The one live check (Task 7) is a `curl` round-trip against **already-shipped, non-mutating** endpoints only; this plan does **not** call `POST /auth/signup` against production — that exercise (with `zzqa_`-prefixed accounts) belongs to the mobile plan's Task 8, once the app can drive the whole signup→confirm→claim flow end to end, not a bare `curl`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/mobile-api/anon-client.ts` | `createAnonClient()` — bare, cookie-less client for signup (no user yet) and public unpersonalized T2 reads |
| `lib/login/actions.ts` (modify) | `recordDailyLogin` returns `DailyLoginResult` instead of `void`, also reads `deletion_requested_at` |
| `lib/mobile-api/endpoints/session.ts` | `toSessionStartResponse`, `sessionStartEndpoint` |
| `lib/auth/signup-service.ts` | `performSignup(authClient, admin, input)` — extracted from `signup()` |
| `lib/auth/actions.ts` (modify) | `signup()` becomes a thin wrapper over `performSignup` |
| `lib/mobile-api/endpoints/auth.ts` | `signupEndpoint`, `resendConfirmationEndpoint`, `requestResetEndpoint` |
| `lib/onboarding/claim-username-service.ts` | `performClaimUsername(supabase, admin, userId, rawUsername)` — extracted from `claimUsername()` |
| `lib/onboarding/actions.ts` (modify) | `claimUsername()` becomes a thin wrapper |
| `lib/mobile-api/endpoints/onboarding.ts` | `claimUsernameEndpoint` |
| `lib/home/summary.ts` | `buildHomeSummary(supabase)`, pure helpers (`sortFeaturedFirst`, `sumPrizePool`, `mapBanner`, `mapLeaderboardRow`), `HomeSummary`/`LeaderboardPlayer` types |
| `app/[locale]/page.tsx` (modify) | calls `buildHomeSummary` instead of its own `Promise.all` block |
| `lib/mobile-api/endpoints/home.ts` | `homeEndpoint` |
| `lib/mobile-api/endpoints/index.ts` (modify) | registers all six new endpoints |

---

### Task 1: `recordDailyLogin` returns a result (pure extension)

**Files:**
- Modify: `lib/login/actions.ts`
- Modify: `lib/login/actions.test.ts` (existing assertions extended, not rewritten — full file shown below since every test's `fakeAdmin` call needs the new field)

**Interfaces:**
- Produces: `interface DailyLoginResult { awardedToday: boolean; coinsAwarded: number; xpAwarded: number; streak: number; milestone: 'week' | 'month' | null; deletionRequestedAt: string | null }`; `recordDailyLogin(admin: Admin, playerId: string, now?: Date): Promise<DailyLoginResult>` (same params as today, new return type).

- [ ] **Step 1: Write the updated test file (still red — `DailyLoginResult` fields don't exist yet)**

`lib/login/actions.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest'
import { recordDailyLogin } from './actions'

vi.mock('@/lib/coins/service', () => ({ recordCoinTransaction: vi.fn() }))
vi.mock('@/lib/membership/xp', () => ({ awardXP: vi.fn() }))

function fakeAdmin(profile: {
  last_login_date: string | null
  login_streak: number
  deletion_requested_at?: string | null
}) {
  const full = { deletion_requested_at: null, ...profile }
  const updates: Record<string, unknown>[] = []
  return {
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: full }) }) }),
        update: (vals: Record<string, unknown>) => ({
          eq: async () => { updates.push(vals); Object.assign(full, vals); return { data: null, error: null } },
        }),
      }),
    },
    updates,
  }
}

describe('recordDailyLogin', () => {
  it('is idempotent for a second call the same day, and still reports the current streak', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-02', login_streak: 3 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-01T23:30:00Z'))
    expect(updates).toEqual([])
    expect(recordCoinTransaction).not.toHaveBeenCalled()
    expect(result).toEqual({
      awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 3, milestone: null, deletionRequestedAt: null,
    })
  })

  it('awards daily coins/xp, bumps the streak on a new day, and reports what it awarded', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client, updates } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 3, deletion_requested_at: null })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))
    expect(updates).toEqual([{ last_login_date: '2026-01-02', login_streak: 4 }])
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 5, xpAwarded: 20, streak: 4, milestone: null, deletionRequestedAt: null,
    })
  })

  it('awards the 7-day streak bonus on day 7 and reports the "week" milestone', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { awardXP } = await import('@/lib/membership/xp')
    const { client } = fakeAdmin({ last_login_date: '2026-01-06', login_streak: 6 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-07T10:00:00Z'))
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 5, 'daily_login', null)
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 20, 'daily_login', null)
    expect(awardXP).toHaveBeenCalledWith(client, 'p1', 100, 'login_streak', null)
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 55, xpAwarded: 120, streak: 7, milestone: 'week', deletionRequestedAt: null,
    })
  })

  it('awards the 30-day streak bonus on day 30, not the 7-day one, and reports the "month" milestone', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    const { client } = fakeAdmin({ last_login_date: '2026-01-29', login_streak: 29 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-30T10:00:00Z'))
    expect(recordCoinTransaction).toHaveBeenCalledWith(client, 'p1', 200, 'login_streak', null)
    expect(recordCoinTransaction).not.toHaveBeenCalledWith(client, 'p1', 50, 'login_streak', null)
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 205, xpAwarded: 520, streak: 30, milestone: 'month', deletionRequestedAt: null,
    })
  })

  it('passes deletion_requested_at through untouched either way', async () => {
    const { client: pending } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 3, deletion_requested_at: '2026-01-05T00:00:00Z' })
    const result = await recordDailyLogin(pending as never, 'p1', new Date('2026-01-01T23:30:00Z'))
    expect(result.deletionRequestedAt).toBe('2026-01-05T00:00:00Z')
  })

  it('never throws even if a downstream call rejects, and still reports the intended award', async () => {
    const { recordCoinTransaction } = await import('@/lib/coins/service')
    vi.mocked(recordCoinTransaction).mockRejectedValueOnce(new Error('boom'))
    const { client } = fakeAdmin({ last_login_date: '2026-01-01', login_streak: 1 })
    const result = await recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))
    expect(result).toEqual({
      awardedToday: true, coinsAwarded: 5, xpAwarded: 20, streak: 2, milestone: null, deletionRequestedAt: null,
    })
  })

  it('never throws and reports nothing awarded when the profile read itself fails', async () => {
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }),
    }
    await expect(recordDailyLogin(client as never, 'p1', new Date('2026-01-02T10:00:00Z'))).resolves.toEqual({
      awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 0, milestone: null, deletionRequestedAt: null,
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/login/actions.test.ts` → Expected: FAIL (`resolves.toBeUndefined()`-shaped expectations no longer match; the file also now imports nothing new, so failures are assertion mismatches, not import errors).

- [ ] **Step 3: Implement**

`lib/login/actions.ts`
```ts
import { nextLoginState } from './streak'
import { recordCoinTransaction } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface DailyLoginResult {
  awardedToday: boolean
  coinsAwarded: number
  xpAwarded: number
  streak: number
  milestone: 'week' | 'month' | null
  deletionRequestedAt: string | null
}

function notAwarded(streak: number, deletionRequestedAt: string | null): DailyLoginResult {
  return { awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak, milestone: null, deletionRequestedAt }
}

// Best-effort, idempotent per WAT calendar day — mirrors the
// notify()/notifyInApp() convention of never throwing into the caller's
// primary render path. design doc §3.7. Returns what it did (or would have
// done) so /session/start (mobile Phase 1) can report it — the one existing
// web call site (dashboard page) ignores the return value, unchanged.
export async function recordDailyLogin(admin: Admin, playerId: string, now: Date = new Date()): Promise<DailyLoginResult> {
  let profile: { last_login_date: string | null; login_streak: number | null; deletion_requested_at: string | null } | null = null
  try {
    const { data, error: profileErr } = await admin
      .from('profiles')
      .select('last_login_date, login_streak, deletion_requested_at')
      .eq('id', playerId)
      .maybeSingle()

    if (profileErr) {
      // A real read failure — never fall through to the "never logged in
      // before" path, which would reset the player's streak to 1.
      console.error('[recordDailyLogin] profile read failed', { playerId, message: profileErr.message })
      return notAwarded(0, null)
    }
    profile = data
  } catch (err) {
    console.error('[recordDailyLogin] profile read threw', { playerId, message: err instanceof Error ? err.message : String(err) })
    return notAwarded(0, null)
  }

  const deletionRequestedAt = profile?.deletion_requested_at ?? null
  const state = nextLoginState({
    lastLoginDate: profile?.last_login_date ?? null,
    loginStreak: profile?.login_streak ?? 0,
    now,
  })
  if (state.alreadyLoggedToday) return notAwarded(profile?.login_streak ?? 0, deletionRequestedAt)

  let coinsAwarded = 5
  let xpAwarded = 20
  let milestone: 'week' | 'month' | null = null
  if (state.newStreak % 30 === 0) milestone = 'month'
  else if (state.newStreak % 7 === 0) milestone = 'week'
  if (milestone === 'month') { coinsAwarded += 200; xpAwarded += 500 }
  else if (milestone === 'week') { coinsAwarded += 50; xpAwarded += 100 }

  try {
    await admin
      .from('profiles')
      .update({ last_login_date: state.todayWAT, login_streak: state.newStreak })
      .eq('id', playerId)

    await recordCoinTransaction(admin, playerId, 5, 'daily_login', null)
    await awardXP(admin, playerId, 20, 'daily_login', null)

    if (milestone === 'month') {
      await recordCoinTransaction(admin, playerId, 200, 'login_streak', null)
      await awardXP(admin, playerId, 500, 'login_streak', null)
    } else if (milestone === 'week') {
      await recordCoinTransaction(admin, playerId, 50, 'login_streak', null)
      await awardXP(admin, playerId, 100, 'login_streak', null)
    }
  } catch (err) {
    console.error('[recordDailyLogin] failed', { playerId, message: err instanceof Error ? err.message : String(err) })
  }

  return { awardedToday: true, coinsAwarded, xpAwarded, streak: state.newStreak, milestone, deletionRequestedAt }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/login/actions.test.ts` → Expected: 7 passed. Then `npx tsc --noEmit` → clean (the one existing call site, `app/[locale]/dashboard/page.tsx:39` `await recordDailyLogin(createAdminClient(), user.id)`, ignores the return value and needs no change — confirm by grepping `recordDailyLogin` for other call sites: `grep -rn recordDailyLogin app lib | grep -v test`, expect only `lib/login/actions.ts` and the one dashboard line).

- [ ] **Step 5: Commit**
```bash
git add lib/login/actions.ts lib/login/actions.test.ts
git commit -m "feat(login): recordDailyLogin reports what it awarded and surfaces deletion_requested_at"
```

---

### Task 2: `POST /session/start`

**Files:**
- Create: `lib/mobile-api/endpoints/session.ts`, `app/api/mobile/v1/session/start/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`
- Test: `lib/mobile-api/endpoints/session.test.ts`

**Interfaces:**
- Consumes: `DailyLoginResult`, `recordDailyLogin` (Task 1); `defineEndpoint`, `MobileCtx` (Phase 0B).
- Produces: `toSessionStartResponse(result: DailyLoginResult): { dailyLogin: Omit<DailyLoginResult, 'deletionRequestedAt'>; deletionRequestedAt: string | null }`; `sessionStartEndpoint: Endpoint`.

- [ ] **Step 1: Write the failing test**

`lib/mobile-api/endpoints/session.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { toSessionStartResponse } from './session'

describe('toSessionStartResponse', () => {
  it('splits deletionRequestedAt out of the daily-login result', () => {
    expect(toSessionStartResponse({
      awardedToday: true, coinsAwarded: 55, xpAwarded: 120, streak: 7, milestone: 'week',
      deletionRequestedAt: '2026-09-10T00:00:00Z',
    })).toEqual({
      dailyLogin: { awardedToday: true, coinsAwarded: 55, xpAwarded: 120, streak: 7, milestone: 'week' },
      deletionRequestedAt: '2026-09-10T00:00:00Z',
    })
  })

  it('reports awardedToday:false with a null deletionRequestedAt untouched', () => {
    expect(toSessionStartResponse({
      awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 3, milestone: null, deletionRequestedAt: null,
    })).toEqual({
      dailyLogin: { awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak: 3, milestone: null },
      deletionRequestedAt: null,
    })
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/mobile-api/endpoints/session.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`lib/mobile-api/endpoints/session.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { recordDailyLogin, type DailyLoginResult } from '@/lib/login/actions'

const dailyLoginResponse = z.object({
  awardedToday: z.boolean(),
  coinsAwarded: z.number(),
  xpAwarded: z.number(),
  streak: z.number(),
  milestone: z.enum(['week', 'month']).nullable(),
})

const sessionStartResponse = z.object({
  dailyLogin: dailyLoginResponse,
  deletionRequestedAt: z.string().nullable(),
})

export function toSessionStartResponse(result: DailyLoginResult) {
  const { deletionRequestedAt, ...dailyLogin } = result
  return { dailyLogin, deletionRequestedAt }
}

export const sessionStartEndpoint = defineEndpoint({
  operationId: 'postSessionStart',
  method: 'POST',
  path: '/session/start',
  summary: 'Runs login()\'s server-side side-effects (daily login coins/XP/streak) and reports deletion-pending status. Call once per app process after a session exists — not on every screen visit.',
  auth: 'user',
  response: sessionStartResponse,
  handler: async ({ ctx }) => {
    // ctx.admin: deletion_requested_at is a private column (S1) and is not
    // readable through ctx.userClient — same reasoning as GET /me.
    const result = await recordDailyLogin(ctx.admin, ctx.userId)
    return toSessionStartResponse(result)
  },
})
```

`app/api/mobile/v1/session/start/route.ts`
```ts
import { sessionStartEndpoint } from '@/lib/mobile-api/endpoints/session'

export const POST = sessionStartEndpoint.handler
```

`lib/mobile-api/endpoints/index.ts` — add `import { sessionStartEndpoint } from './session'` and append `sessionStartEndpoint` to `ALL_ENDPOINTS`.

- [ ] **Step 4: Refresh contract and verify**

Run: `npm run openapi` → `npx vitest run lib/mobile-api` → all pass; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**
```bash
git add lib/mobile-api app/api/mobile openapi
git commit -m "feat(mobile-api): POST /session/start (daily login award + deletion-pending status)"
```

---

### Task 3: `POST /auth/signup`

**Files:**
- Create: `lib/mobile-api/anon-client.ts`, `lib/auth/signup-service.ts`, `lib/mobile-api/endpoints/auth.ts`, `app/api/mobile/v1/auth/signup/route.ts`
- Modify: `lib/auth/actions.ts`, `lib/mobile-api/endpoints/index.ts`
- Test: `lib/auth/signup-service.test.ts`

**Interfaces:**
- Consumes: `isIdentifierBanned`, `isUsernameRetired` (`lib/auth/signup-blocks.ts`); `mapSignupError` (`lib/auth/errors.ts`); `LOCALES`, `Locale` (`i18n/locales.ts`); `createAdminClient` (`lib/supabase/admin.ts`); `defineEndpoint`; `usernameSchema`, `passwordSchema` (`lib/auth/schema.ts`).
- Produces: `createAnonClient(): SupabaseClient<Database>`; `interface SignupServiceInput { username: string; email: string; password: string; ref?: string; locale?: string }`; `type SignupServiceErrorCode = 'blocked_details' | 'username_taken' | 'username_taken_go_back' | 'signup_failed'`; `type SignupServiceResult = { ok: true } | { ok: false; errorCode: SignupServiceErrorCode }`; `performSignup(authClient, admin, input): Promise<SignupServiceResult>`; `signupEndpoint`.

- [ ] **Step 1: Write the failing test**

`lib/auth/signup-service.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest'
import { performSignup } from './signup-service'

function fakeAuthClient(signUpResult: { data: { user: { id: string } | null }; error: unknown }) {
  return { auth: { signUp: vi.fn().mockResolvedValue(signUpResult) } }
}

function fakeAdmin(opts: { banned?: boolean; retired?: boolean } = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn((table: string) => {
    if (table === 'banned_identifiers') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.banned ? { hash: 'x' } : null } as never) }) }) }
    if (table === 'retired_usernames') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.retired ? { username: 'x' } : null } as never) }) }) }
    if (table === 'profiles') return { update }
    throw new Error(`unexpected table ${table}`)
  })
  return { admin: { from } as never, update, updateEq }
}

const input = { username: 'newplayer', email: 'new@x.com', password: 'password123' }

describe('performSignup', () => {
  it('rejects a banned identifier without calling signUp', async () => {
    const authClient = fakeAuthClient({ data: { user: null }, error: null })
    const { admin } = fakeAdmin({ banned: true })
    const result = await performSignup(authClient as never, admin, input)
    expect(result).toEqual({ ok: false, errorCode: 'blocked_details' })
    expect(authClient.auth.signUp).not.toHaveBeenCalled()
  })

  it('rejects a retired username without calling signUp', async () => {
    const authClient = fakeAuthClient({ data: { user: null }, error: null })
    const { admin } = fakeAdmin({ retired: true })
    const result = await performSignup(authClient as never, admin, input)
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
    expect(authClient.auth.signUp).not.toHaveBeenCalled()
  })

  it('signs up, passes username (+ ref) as metadata, and seeds the locale via the service role', async () => {
    const authClient = fakeAuthClient({ data: { user: { id: 'user-1' } }, error: null })
    const { admin, update, updateEq } = fakeAdmin()
    const result = await performSignup(authClient as never, admin, { ...input, ref: 'friend1', locale: 'fr' })
    expect(result).toEqual({ ok: true })
    expect(authClient.auth.signUp).toHaveBeenCalledWith({
      email: 'new@x.com', password: 'password123',
      options: { data: { username: 'newplayer', ref: 'friend1' } },
    })
    expect(update).toHaveBeenCalledWith({ locale: 'fr' })
    expect(updateEq).toHaveBeenCalled()
  })

  it('omits ref from metadata when absent', async () => {
    const authClient = fakeAuthClient({ data: { user: { id: 'user-2' } }, error: null })
    const { admin } = fakeAdmin()
    await performSignup(authClient as never, admin, input)
    expect(authClient.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { data: { username: 'newplayer' } } }),
    )
  })

  it('defaults locale to en for a missing or unknown locale', async () => {
    const authClient = fakeAuthClient({ data: { user: { id: 'user-3' } }, error: null })
    const { admin, update } = fakeAdmin()
    await performSignup(authClient as never, admin, { ...input, locale: 'de' })
    expect(update).toHaveBeenCalledWith({ locale: 'en' })
  })

  it('maps a Supabase signUp error through mapSignupError and logs it', async () => {
    const authClient = fakeAuthClient({ data: { user: null }, error: { message: 'duplicate key value', code: '23505' } })
    const { admin, update } = fakeAdmin()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await performSignup(authClient as never, admin, input)
    expect(result).toEqual({ ok: false, errorCode: 'username_taken_go_back' })
    expect(update).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/auth/signup-service.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`lib/mobile-api/anon-client.ts`
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

// A bare, cookie-less, session-less client — for calls with no bearer token
// yet (signup: there is no user) or public reads that aren't personalized.
// RLS applies as `anon`, same as an unauthenticated web visitor.
export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}
```

`lib/auth/signup-service.ts`
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { isIdentifierBanned, isUsernameRetired } from './signup-blocks'
import { mapSignupError } from './errors'
import { LOCALES, type Locale } from '@/i18n/locales'

export interface SignupServiceInput {
  username: string
  email: string
  password: string
  ref?: string
  locale?: string
}

export type SignupServiceErrorCode =
  | 'blocked_details'
  | 'username_taken'
  | 'username_taken_go_back'
  | 'signup_failed'

export type SignupServiceResult = { ok: true } | { ok: false; errorCode: SignupServiceErrorCode }

// Extracted from lib/auth/actions.ts's signup() — the Server Action and
// POST /auth/signup both call this, so ban/retired-username/locale-seeding
// behavior can never drift between web and mobile.
export async function performSignup(
  authClient: SupabaseClient<Database>,
  admin: ReturnType<typeof createAdminClient>,
  input: SignupServiceInput,
): Promise<SignupServiceResult> {
  const { username, email, password, ref, locale: rawLocale } = input

  // Ban evasion: only ever populated for accounts deleted while flagged for
  // cheating. Generic error on purpose — a distinct one would let anyone
  // probe the blocklist for a given address.
  if (await isIdentifierBanned(admin, email)) {
    return { ok: false, errorCode: 'blocked_details' }
  }
  // Checked here as well as at claim time: rejecting at the wizard is a far
  // better experience than accepting the signup and refusing the handle
  // after the user has confirmed their email.
  if (await isUsernameRetired(admin, username)) {
    return { ok: false, errorCode: 'username_taken' }
  }

  // The username is NOT claimed here — see migration 073. It rides along as
  // signup metadata and is claimed after email confirmation at
  // /onboarding/username. The email link format (token_hash + type + next)
  // is controlled by the Supabase "Confirm signup" template → /auth/confirm.
  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: { data: ref ? { username, ref } : { username } },
  })
  if (error) {
    console.error('[performSignup] supabase.auth.signUp failed', {
      email,
      code: (error as { code?: string }).code,
      status: (error as { status?: number }).status,
      message: (error as { message?: string }).message,
    })
    return { ok: false, errorCode: mapSignupError(error) }
  }

  // Seeds the new player's language. profiles can only be written via the
  // service role since the S2 lock-down (20260918200000_...sql).
  const locale: Locale = LOCALES.includes(rawLocale as Locale) ? (rawLocale as Locale) : 'en'
  if (data.user) {
    await admin.from('profiles').update({ locale }).eq('id', data.user.id)
  }

  return { ok: true }
}
```

`lib/mobile-api/endpoints/auth.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { createAnonClient } from '../anon-client'
import { createAdminClient } from '@/lib/supabase/admin'
import { performSignup, type SignupServiceErrorCode } from '@/lib/auth/signup-service'
import { usernameSchema, passwordSchema } from '@/lib/auth/schema'
import { LOCALES } from '@/i18n/locales'

const SIGNUP_ERROR_MESSAGES: Record<SignupServiceErrorCode, string> = {
  blocked_details: 'That email or username can’t be used.',
  username_taken: 'That username is taken.',
  username_taken_go_back: 'That username was just taken — go back and pick another.',
  signup_failed: 'Signup failed. Please try again.',
}

const signupBody = z.object({
  username: usernameSchema,
  email: z.string().trim().email('invalid_email'),
  password: passwordSchema,
  ref: z.string().trim().optional(),
  locale: z.enum(LOCALES).optional(),
})
const ok = z.object({ ok: z.literal(true) })

export const signupEndpoint = defineEndpoint({
  operationId: 'postAuthSignup',
  method: 'POST',
  path: '/auth/signup',
  summary: 'Create an account (ban/retired-username checks, referral + locale metadata). A confirmation email follows via the existing Supabase template.',
  auth: 'public',
  body: signupBody,
  response: ok,
  handler: async ({ body }) => {
    const result = await performSignup(createAnonClient(), createAdminClient(), body)
    if (!result.ok) throw new ApiError(422, result.errorCode, SIGNUP_ERROR_MESSAGES[result.errorCode])
    return { ok: true as const }
  },
})

const emailBody = z.object({ email: z.string().trim().email('invalid_email') })

export const resendConfirmationEndpoint = defineEndpoint({
  operationId: 'postAuthResendConfirmation',
  method: 'POST',
  path: '/auth/resend-confirmation',
  summary: 'Re-send the signup confirmation email. Always returns ok — neutral regardless of whether the address maps to an unconfirmed account.',
  auth: 'public',
  body: emailBody,
  response: ok,
  handler: async ({ body }) => {
    const { error } = await createAnonClient().auth.resend({ type: 'signup', email: body.email.trim().toLowerCase() })
    if (error && (error as { code?: string }).code !== 'over_email_send_rate_limit') {
      console.error('[resendConfirmationEndpoint] resend failed', { code: (error as { code?: string }).code, message: error.message })
    }
    return { ok: true as const }
  },
})

export const requestResetEndpoint = defineEndpoint({
  operationId: 'postAuthRequestReset',
  method: 'POST',
  path: '/auth/request-reset',
  summary: 'Send a password-reset email. Always returns ok — neutral regardless of whether the account exists.',
  auth: 'public',
  body: emailBody,
  response: ok,
  handler: async ({ body }) => {
    await createAnonClient().auth.resetPasswordForEmail(body.email.trim())
    return { ok: true as const }
  },
})
```

`app/api/mobile/v1/auth/signup/route.ts`
```ts
import { signupEndpoint } from '@/lib/mobile-api/endpoints/auth'

export const POST = signupEndpoint.handler
```

`app/api/mobile/v1/auth/resend-confirmation/route.ts`
```ts
import { resendConfirmationEndpoint } from '@/lib/mobile-api/endpoints/auth'

export const POST = resendConfirmationEndpoint.handler
```

`app/api/mobile/v1/auth/request-reset/route.ts`
```ts
import { requestResetEndpoint } from '@/lib/mobile-api/endpoints/auth'

export const POST = requestResetEndpoint.handler
```

Now make `signup()` in `lib/auth/actions.ts` a thin wrapper — replace its body (from `const { username, email, password, ref } = parsed.data` through the `return { noticeCode: 'check_email' }` line) with:
```ts
  const cookieLocale = cookies().get('NEXT_LOCALE')?.value
  const result = await performSignup(createClient(), createAdminClient(), { ...parsed.data, locale: cookieLocale })
  if (!result.ok) return { errorCode: result.errorCode }
  return { noticeCode: 'check_email' }
```
Add `import { performSignup } from './signup-service'` at the top of `lib/auth/actions.ts`. `mapSignupError` and `isIdentifierBanned`/`isUsernameRetired` imports in `actions.ts` become unused — remove them (their only remaining consumer is `signup-service.ts`).

- [ ] **Step 4: Run to verify signup-service tests pass, and that the existing Server Action test suite is untouched**

Run: `npx vitest run lib/auth/signup-service.test.ts` → Expected: 6 passed.
Run: `npx vitest run lib/auth/actions.test.ts` → Expected: still all passing, **with zero edits to that file** — `performSignup` preserves the exact call order (`isIdentifierBanned` then `isUsernameRetired` against `adminMaybeSingle`'s queued mocks), the exact `admin.from('profiles').update({locale})` call the `adminUpdate` mock already expects, and the exact `authClient.auth.signUp` call the `signUp` mock already expects. If any assertion fails, the extraction changed behavior — stop and fix `performSignup`, do not edit the test to match.
Run: `npx tsc --noEmit` → clean (confirms the removed imports in `actions.ts` were fully unused).

- [ ] **Step 5: Refresh contract and commit**

Run: `npm run openapi` → `npx vitest run lib/mobile-api lib/auth` → all pass.
```bash
git add lib/mobile-api lib/auth app/api/mobile openapi
git commit -m "feat(mobile-api): POST /auth/signup, /auth/resend-confirmation, /auth/request-reset"
```

Wire into the registry: `lib/mobile-api/endpoints/index.ts` — add `import { signupEndpoint, resendConfirmationEndpoint, requestResetEndpoint } from './auth'` and append all three to `ALL_ENDPOINTS`, then repeat Step 5's commands and commit (folded into the same commit if not yet made, since `npm run openapi` needs every endpoint registered first — run `npm run openapi` and stage `index.ts` too before committing).

---

### Task 4: `POST /onboarding/username`

**Files:**
- Create: `lib/onboarding/claim-username-service.ts`, `lib/mobile-api/endpoints/onboarding.ts`, `app/api/mobile/v1/onboarding/username/route.ts`
- Modify: `lib/onboarding/actions.ts`, `lib/mobile-api/endpoints/index.ts`
- Test: `lib/onboarding/claim-username-service.test.ts`

**Interfaces:**
- Consumes: `usernameSchema` (`lib/auth/schema.ts`); `isUsernameRetired` (`lib/auth/signup-blocks.ts`); `createAdminClient`.
- Produces: `type ClaimUsernameErrorCode = 'username_too_short' | 'username_too_long' | 'username_charset' | 'username_taken' | 'username_save_failed'`; `type ClaimUsernameServiceResult = { ok: true; username: string } | { ok: false; errorCode: ClaimUsernameErrorCode }`; `performClaimUsername(supabase, admin, userId, rawUsername): Promise<ClaimUsernameServiceResult>`; `claimUsernameEndpoint`.

- [ ] **Step 1: Write the failing test**

`lib/onboarding/claim-username-service.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest'
import { performClaimUsername } from './claim-username-service'

function fakeSupabase(existing: { id: string } | null) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }) }) } as never
}

function fakeAdmin(opts: { retired?: boolean; updateError?: { code?: string } | null } = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn((table: string) => {
    if (table === 'retired_usernames') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.retired ? { username: 'x' } : null }) }) }) }
    if (table === 'profiles') return { update }
    throw new Error(`unexpected table ${table}`)
  })
  return { admin: { from } as never, update, updateEq }
}

describe('performClaimUsername', () => {
  it('rejects an invalid username without touching the database', async () => {
    const { admin } = fakeAdmin()
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'ab')
    expect(result).toEqual({ ok: false, errorCode: 'username_too_short' })
  })

  it('rejects an already-claimed username', async () => {
    const { admin } = fakeAdmin()
    const result = await performClaimUsername(fakeSupabase({ id: 'someone-else' }), admin, 'u1', 'taken')
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('rejects a retired username even though it is free in profiles', async () => {
    const { admin } = fakeAdmin({ retired: true })
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'sniperking')
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('claims a clean username via the service role', async () => {
    const { admin, update, updateEq } = fakeAdmin()
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'BrandNew')
    expect(result).toEqual({ ok: true, username: 'BrandNew' })
    expect(update).toHaveBeenCalledWith({ username: 'BrandNew', display_name: 'BrandNew' })
    expect(updateEq).toHaveBeenCalled()
  })

  it('maps a unique-violation race to username_taken', async () => {
    const { admin } = fakeAdmin({ updateError: { code: '23505' } })
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'racer')
    expect(result).toEqual({ ok: false, errorCode: 'username_taken' })
  })

  it('maps any other update failure to username_save_failed', async () => {
    const { admin } = fakeAdmin({ updateError: { code: '500' } })
    const result = await performClaimUsername(fakeSupabase(null), admin, 'u1', 'unlucky')
    expect(result).toEqual({ ok: false, errorCode: 'username_save_failed' })
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/onboarding/claim-username-service.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`lib/onboarding/claim-username-service.ts`
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { usernameSchema } from '@/lib/auth/schema'
import { isUsernameRetired } from '@/lib/auth/signup-blocks'

export type ClaimUsernameErrorCode =
  | 'username_too_short'
  | 'username_too_long'
  | 'username_charset'
  | 'username_taken'
  | 'username_save_failed'

export type ClaimUsernameServiceResult =
  | { ok: true; username: string }
  | { ok: false; errorCode: ClaimUsernameErrorCode }

// Extracted from lib/onboarding/actions.ts's claimUsername() — the Server
// Action and POST /onboarding/username both call this.
export async function performClaimUsername(
  supabase: SupabaseClient<Database>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  rawUsername: string,
): Promise<ClaimUsernameServiceResult> {
  const parsed = usernameSchema.safeParse(rawUsername)
  if (!parsed.success) {
    return { ok: false, errorCode: parsed.error.issues[0].message as ClaimUsernameErrorCode }
  }

  const { data: existing } = await supabase.from('profiles').select('id').eq('username', parsed.data).maybeSingle()
  if (existing) return { ok: false, errorCode: 'username_taken' }

  // A retired handle is free in `profiles` — the tombstone holds
  // 'deleted_<id>' instead — so the uniqueness check above cannot see it.
  if (await isUsernameRetired(admin, parsed.data)) {
    return { ok: false, errorCode: 'username_taken' }
  }

  // profiles can only be written via the service role since the S2
  // lock-down (20260918200000_...sql).
  const { error } = await admin.from('profiles').update({ username: parsed.data, display_name: parsed.data }).eq('id', userId)
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, errorCode: 'username_taken' }
    return { ok: false, errorCode: 'username_save_failed' }
  }

  return { ok: true, username: parsed.data }
}
```

`lib/mobile-api/endpoints/onboarding.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError } from '../errors'
import { performClaimUsername, type ClaimUsernameErrorCode } from '@/lib/onboarding/claim-username-service'

const USERNAME_ERROR_MESSAGES: Record<ClaimUsernameErrorCode, string> = {
  username_too_short: 'Username must be at least 3 characters.',
  username_too_long: 'Username must be 20 characters or fewer.',
  username_charset: 'Usernames can only contain letters, numbers and underscores.',
  username_taken: 'That username is taken.',
  username_save_failed: 'Could not save that username. Please try again.',
}

const usernameBody = z.object({ username: z.string() })
const usernameResponse = z.object({ username: z.string() })

export const claimUsernameEndpoint = defineEndpoint({
  operationId: 'postOnboardingUsername',
  method: 'POST',
  path: '/onboarding/username',
  summary: 'Claim a username after email confirmation — resolveOnboardingGate’s first step.',
  auth: 'user',
  body: usernameBody,
  response: usernameResponse,
  handler: async ({ ctx, body }) => {
    const result = await performClaimUsername(ctx.userClient, ctx.admin, ctx.userId, body.username)
    if (!result.ok) throw new ApiError(400, result.errorCode, USERNAME_ERROR_MESSAGES[result.errorCode])
    return { username: result.username }
  },
})
```

`app/api/mobile/v1/onboarding/username/route.ts`
```ts
import { claimUsernameEndpoint } from '@/lib/mobile-api/endpoints/onboarding'

export const POST = claimUsernameEndpoint.handler
```

Now make `claimUsername()` in `lib/onboarding/actions.ts` a thin wrapper — replace its body (from `const supabase = createClient()` through the `error.code === '23505'` block, keeping the leading `usernameSchema.safeParse` guard removed since the service now does it) with:
```ts
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const result = await performClaimUsername(supabase, createAdminClient(), user.id, String(formData.get('username') ?? ''))
  if (!result.ok) return { errorCode: result.errorCode }

  redirect(safeInternalPath(formData.get('next') as string | null, '/dashboard'))
```
Remove the now-unused top-level `usernameSchema.safeParse(formData.get('username'))` block and the `isUsernameRetired` import (its only remaining caller is the new service file); add `import { performClaimUsername } from './claim-username-service'`.

- [ ] **Step 4: Verify**

Run: `npx vitest run lib/onboarding/claim-username-service.test.ts` → Expected: 6 passed.
Run: `npm run test` (full suite — `claimUsername` has no prior dedicated test file, so there is nothing else to regress, but the full run catches any import breakage elsewhere) → Expected: all green.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Wire, refresh contract, commit**

`lib/mobile-api/endpoints/index.ts` — add `import { claimUsernameEndpoint } from './onboarding'`, append to `ALL_ENDPOINTS`.
```bash
npm run openapi
git add lib/mobile-api lib/onboarding app/api/mobile openapi
git commit -m "feat(mobile-api): POST /onboarding/username"
```

---

### Task 5: `GET /home`

**Files:**
- Create: `lib/home/summary.ts`, `lib/mobile-api/endpoints/home.ts`, `app/api/mobile/v1/home/route.ts`
- Modify: `app/[locale]/page.tsx`, `lib/mobile-api/endpoints/index.ts`
- Test: `lib/home/summary.test.ts`

**Interfaces:**
- Consumes: `fetchChampions`, `latestChampion` (`lib/tournaments/champions.ts`); `TournamentCardData` (`components/tournament/TournamentCard.tsx`); `HallOfFameTeaserData` (`lib/home/hall-of-fame-teaser.ts`); `createAnonClient` (Task 3).
- Produces: `interface LeaderboardPlayer { id, username, displayName, avatarUrl, wins, totalMatches, sxScore, sentinelTier, membershipTier, equippedAvatarBorder }`; `interface HomeSummary { banner, featuredTournament, upcomingTournaments, leaderboardTeaser, hallOfFame, stats }`; pure helpers `sortFeaturedFirst(tournaments)`, `sumPrizePool(completed)`, `mapBanner(raw)`, `mapLeaderboardRow(p)`; `buildHomeSummary(supabase): Promise<HomeSummary>`; `homeEndpoint`.

- [ ] **Step 1: Write the failing test**

`lib/home/summary.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest'
import { sortFeaturedFirst, sumPrizePool, mapBanner, mapLeaderboardRow, mapTournamentCard, buildHomeSummary } from './summary'

vi.mock('@/lib/tournaments/champions', () => ({
  fetchChampions: vi.fn().mockResolvedValue([]),
  latestChampion: vi.fn(() => null),
}))

describe('sortFeaturedFirst', () => {
  it('moves the active tournament to the front', () => {
    const t = (id: string, status: string) => ({ id, status }) as never
    const sorted = sortFeaturedFirst([t('a', 'registration_open'), t('b', 'active'), t('c', 'registration_open')])
    expect(sorted.map((x: { id: string }) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('leaves order unchanged when nothing is active', () => {
    const t = (id: string) => ({ id, status: 'registration_open' }) as never
    expect(sortFeaturedFirst([t('a'), t('b')]).map((x: { id: string }) => x.id)).toEqual(['a', 'b'])
  })
})

describe('sumPrizePool', () => {
  it('sums prize_pool across completed tournaments, treating null as 0', () => {
    expect(sumPrizePool([{ prize_pool: 5000 }, { prize_pool: null }, { prize_pool: 3000 }])).toBe(8000)
  })
  it('returns 0 for an empty or null list', () => {
    expect(sumPrizePool([])).toBe(0)
    expect(sumPrizePool(null)).toBe(0)
  })
})

describe('mapBanner', () => {
  it('maps a banner row to camelCase', () => {
    expect(mapBanner({ title: 'Hero', image_url: '/a.png', link_url: '/tournaments' })).toEqual({
      title: 'Hero', imageUrl: '/a.png', linkUrl: '/tournaments',
    })
  })
  it('returns null for no active banner', () => {
    expect(mapBanner(null)).toBeNull()
  })
})

describe('mapLeaderboardRow', () => {
  it('maps a profile row to camelCase', () => {
    expect(mapLeaderboardRow({
      id: 'p1', username: 'ada', display_name: 'Ada', avatar_url: null, wins: 10, total_matches: 15,
      sx_score: 900, sentinel_tier: 'elite', membership_tier: 'guardian', equipped_avatar_border: 'gold',
    })).toEqual({
      id: 'p1', username: 'ada', displayName: 'Ada', avatarUrl: null, wins: 10, totalMatches: 15,
      sxScore: 900, sentinelTier: 'elite', membershipTier: 'guardian', equippedAvatarBorder: 'gold',
    })
  })
})

describe('mapTournamentCard', () => {
  it('maps a TournamentCardData row to camelCase for the wire response (buildHomeSummary itself stays snake_case for the web page’s <TournamentCard> component)', () => {
    expect(mapTournamentCard({
      id: 't1', title: 'FC Mobile Cup', slug: 'fc-mobile-cup', prize_pool: 8000, registration_fee: 500,
      status: 'active', tournament_start: '2026-09-25T18:00:00Z', registration_end: '2026-09-24T18:00:00Z',
      tournament_end: null, max_players: 16, format: 'knockout', tournament_type: 'masters', card_image_url: null,
      games: { name: 'EA FC Mobile', icon_url: '/icons/fc.png', slug: 'ea-fc-mobile', category: 'football' },
    })).toEqual({
      id: 't1', title: 'FC Mobile Cup', slug: 'fc-mobile-cup', prizePool: 8000, registrationFee: 500,
      status: 'active', tournamentStart: '2026-09-25T18:00:00Z', registrationEnd: '2026-09-24T18:00:00Z',
      tournamentEnd: null, maxPlayers: 16, format: 'knockout', tournamentType: 'masters', cardImageUrl: null,
      game: { name: 'EA FC Mobile', iconUrl: '/icons/fc.png', slug: 'ea-fc-mobile', category: 'football' },
    })
  })

  it('maps a null games relation to a null game', () => {
    expect(mapTournamentCard({
      id: 't2', title: 'x', slug: 'x', prize_pool: 0, registration_fee: 0, status: 'draft',
      tournament_start: null, registration_end: null, tournament_end: null, max_players: null, games: null,
    }).game).toBeNull()
  })
})

describe('buildHomeSummary', () => {
  it('composes all six queries plus the champions teaser into one summary', async () => {
    const tournamentsSelect = { in: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 't1', status: 'active' }] }) }) }) }
    const completedSelect = { eq: async () => ({ data: [{ prize_pool: 1000 }] }) }
    const profilesCount = async () => ({ count: 42 })
    const tournamentsCount = { neq: async () => ({ count: 7 }) }
    const from = vi.fn((table: string) => {
      if (table === 'tournaments') {
        return {
          select: (cols: string) => (cols.includes('*') ? tournamentsCount : cols === 'prize_pool' ? completedSelect : tournamentsSelect),
        }
      }
      if (table === 'profiles') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) =>
            opts?.count
              ? profilesCount()
              : { order: () => ({ gt: () => ({ limit: async () => ({ data: [{ id: 'p1', username: 'ada', display_name: 'Ada', avatar_url: null, wins: 10, total_matches: 15, sx_score: 900, sentinel_tier: 'elite', membership_tier: 'guardian', equipped_avatar_border: null }] }) }) }) }),
        }
      }
      if (table === 'homepage_banners') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const supabase = { from } as never

    const summary = await buildHomeSummary(supabase)
    expect(summary.featuredTournament).toEqual({ id: 't1', status: 'active' })
    expect(summary.upcomingTournaments).toEqual([])
    expect(summary.leaderboardTeaser).toHaveLength(1)
    expect(summary.leaderboardTeaser[0].username).toBe('ada')
    expect(summary.banner).toBeNull()
    expect(summary.hallOfFame).toBeNull()
    expect(summary.stats).toEqual({ playerCount: 42, tournamentCount: 7, prizesPaidOut: 1000 })
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/home/summary.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`lib/home/summary.ts`
```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { TournamentCardData } from '@/components/tournament/TournamentCard'
import { fetchChampions, latestChampion } from '@/lib/tournaments/champions'
import type { HallOfFameTeaserData } from './hall-of-fame-teaser'

export interface LeaderboardPlayer {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  wins: number
  totalMatches: number
  sxScore: number
  sentinelTier: string | null
  membershipTier: string | null
  equippedAvatarBorder: string | null
}

export interface HomeBanner {
  title: string
  imageUrl: string | null
  linkUrl: string | null
}

// buildHomeSummary() stays in TournamentCardData's native snake_case, because
// the web page passes featuredTournament/upcomingTournaments straight into
// the existing <TournamentCard> component, which is typed against that exact
// shape. The API layer (lib/mobile-api/endpoints/home.ts) maps each card
// through mapTournamentCard() below for its camelCase wire response — the
// same "raw internally, camelCase on the wire" split mapLeaderboardRow
// already does for players, just applied consistently to tournaments too.
export interface HomeSummary {
  banner: HomeBanner | null
  featuredTournament: TournamentCardData | null
  upcomingTournaments: TournamentCardData[]
  leaderboardTeaser: LeaderboardPlayer[]
  hallOfFame: HallOfFameTeaserData | null
  stats: { playerCount: number; tournamentCount: number; prizesPaidOut: number }
}

export interface TournamentCardSummary {
  id: string
  title: string
  slug: string
  prizePool: number
  registrationFee: number
  status: string
  tournamentStart: string | null
  registrationEnd: string | null
  tournamentEnd: string | null
  maxPlayers: number | null
  format: string | null
  tournamentType: string | null
  cardImageUrl: string | null
  game: { name: string; iconUrl: string | null; slug: string | null; category: string | null } | null
}

export function mapTournamentCard(t: TournamentCardData): TournamentCardSummary {
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    prizePool: t.prize_pool,
    registrationFee: t.registration_fee,
    status: t.status,
    tournamentStart: t.tournament_start,
    registrationEnd: t.registration_end,
    tournamentEnd: t.tournament_end ?? null,
    maxPlayers: t.max_players,
    format: t.format ?? null,
    tournamentType: t.tournament_type ?? null,
    cardImageUrl: t.card_image_url ?? null,
    game: t.games ? { name: t.games.name, iconUrl: t.games.icon_url, slug: t.games.slug ?? null, category: t.games.category ?? null } : null,
  }
}

// Ensures any 'active' tournament shows first as featured — matches the
// homepage's pre-existing sort exactly.
export function sortFeaturedFirst<T extends { status: string }>(tournaments: T[]): T[] {
  return [...tournaments].sort((a, b) =>
    a.status === 'active' && b.status !== 'active' ? -1
    : b.status === 'active' && a.status !== 'active' ? 1
    : 0,
  )
}

export function sumPrizePool(completed: { prize_pool: number | null }[] | null): number {
  return (completed ?? []).reduce((sum, t) => sum + (t.prize_pool ?? 0), 0)
}

export function mapBanner(raw: { title: string; image_url: string | null; link_url: string | null } | null): HomeBanner | null {
  return raw ? { title: raw.title, imageUrl: raw.image_url, linkUrl: raw.link_url } : null
}

export function mapLeaderboardRow(p: {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  wins: number
  total_matches: number
  sx_score: number
  sentinel_tier: string | null
  membership_tier: string | null
  equipped_avatar_border: string | null
}): LeaderboardPlayer {
  return {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    wins: p.wins,
    totalMatches: p.total_matches,
    sxScore: p.sx_score,
    sentinelTier: p.sentinel_tier,
    membershipTier: p.membership_tier,
    equippedAvatarBorder: p.equipped_avatar_border,
  }
}

// Extracted from app/[locale]/page.tsx's data-fetching block — the page and
// GET /home both call this, so the numbers can never drift.
export async function buildHomeSummary(supabase: SupabaseClient<Database>): Promise<HomeSummary> {
  const [
    { data: rawTournaments },
    { data: players },
    { data: rawBanner },
    { data: completedTournaments },
    { count: playerCount },
    { count: tournamentCount },
  ] = await Promise.all([
    supabase
      .from('tournaments')
      .select(
        'id, title, slug, prize_pool, registration_fee, status, tournament_start, registration_end, tournament_end, max_players, format, tournament_type, card_image_url, games(name, icon_url, slug, category)',
      )
      .in('status', ['active', 'registration_open'])
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, wins, total_matches, sx_score, sentinel_tier, membership_tier, equipped_avatar_border')
      .order('wins', { ascending: false })
      .gt('total_matches', 0)
      .limit(5),
    supabase.from('homepage_banners').select('title, image_url, link_url').eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tournaments').select('prize_pool').eq('status', 'completed'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('tournaments').select('*', { count: 'exact', head: true }).neq('status', 'draft'),
  ])

  const latest = latestChampion(await fetchChampions(supabase))
  const hallOfFame: HallOfFameTeaserData | null = latest
    ? { slug: latest.slug, title: latest.title, prizePool: latest.prizePool ?? 0, gameName: latest.gameName || null, championName: latest.champion.name }
    : null

  const tournaments = sortFeaturedFirst((rawTournaments ?? []) as TournamentCardData[])

  return {
    banner: mapBanner(rawBanner ?? null),
    featuredTournament: tournaments[0] ?? null,
    upcomingTournaments: tournaments.slice(1),
    leaderboardTeaser: (players ?? []).map(mapLeaderboardRow),
    hallOfFame,
    stats: { playerCount: playerCount ?? 0, tournamentCount: tournamentCount ?? 0, prizesPaidOut: sumPrizePool(completedTournaments) },
  }
}
```

`lib/mobile-api/endpoints/home.ts`
```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { buildHomeSummary, mapTournamentCard } from '@/lib/home/summary'

const tournamentCard = z.object({
  id: z.string(), title: z.string(), slug: z.string(), prizePool: z.number(), registrationFee: z.number(),
  status: z.string(), tournamentStart: z.string().nullable(), registrationEnd: z.string().nullable(),
  tournamentEnd: z.string().nullable(), maxPlayers: z.number().nullable(), format: z.string().nullable(),
  tournamentType: z.string().nullable(), cardImageUrl: z.string().nullable(),
  game: z.object({ name: z.string(), iconUrl: z.string().nullable(), slug: z.string().nullable(), category: z.string().nullable() }).nullable(),
})

const leaderboardPlayer = z.object({
  id: z.string(), username: z.string().nullable(), displayName: z.string().nullable(), avatarUrl: z.string().nullable(),
  wins: z.number(), totalMatches: z.number(), sxScore: z.number(), sentinelTier: z.string().nullable(),
  membershipTier: z.string().nullable(), equippedAvatarBorder: z.string().nullable(),
})

const homeResponse = z.object({
  banner: z.object({ title: z.string(), imageUrl: z.string().nullable(), linkUrl: z.string().nullable() }).nullable(),
  featuredTournament: tournamentCard.nullable(),
  upcomingTournaments: z.array(tournamentCard),
  leaderboardTeaser: z.array(leaderboardPlayer),
  hallOfFame: z.object({
    slug: z.string(), title: z.string(), prizePool: z.number(), gameName: z.string().nullable(), championName: z.string(),
  }).nullable(),
  stats: z.object({ playerCount: z.number(), tournamentCount: z.number(), prizesPaidOut: z.number() }),
})

export const homeEndpoint = defineEndpoint({
  operationId: 'getHome',
  method: 'GET',
  path: '/home',
  summary: 'Home: banners, live/upcoming tournaments, leaderboard teaser, hall-of-fame teaser, platform stats. Public — visible logged out, same as the web home page.',
  auth: 'public',
  cacheControl: 'public, s-maxage=30, stale-while-revalidate=120',
  response: homeResponse,
  handler: async () => {
    const summary = await buildHomeSummary(createAnonClient())
    return {
      ...summary,
      featuredTournament: summary.featuredTournament ? mapTournamentCard(summary.featuredTournament) : null,
      upcomingTournaments: summary.upcomingTournaments.map(mapTournamentCard),
    }
  },
})
```

`app/api/mobile/v1/home/route.ts`
```ts
import { homeEndpoint } from '@/lib/mobile-api/endpoints/home'

export const GET = homeEndpoint.handler
```

Now refactor `app/[locale]/page.tsx`'s `HomePage` body. Replace the entire `Promise.all` block, the `prizesPaidOut` line, the `latest`/`hallOfFameTeaserData` block, the `banner` line, and the `tournaments`/`featured`/`upcoming`/`leaderboard` lines with:
```ts
  const summary = await buildHomeSummary(supabase)
  const { banner, hallOfFame: hallOfFameTeaserData, stats } = summary
  const featured = summary.featuredTournament
  const upcoming = summary.upcomingTournaments
  const leaderboard = summary.leaderboardTeaser
  const { playerCount, tournamentCount, prizesPaidOut } = stats
```
Add `import { buildHomeSummary } from '@/lib/home/summary'` and remove the now-unused `fetchChampions`, `latestChampion`, `HallOfFameTeaserData` imports (their only remaining caller is `lib/home/summary.ts`) and the now-unused `TournamentCardData` import if nothing else in the file references it (check with `grep -n TournamentCardData "app/[locale]/page.tsx"` — the `<TournamentCard>` JSX usages don't need the type import, only the removed inline `as TournamentCardData[]` cast did). The rest of the JSX (`<Hero playerCount={...} .../>`, `<LiveTournamentStrip tournament={featured} />`, the `upcoming.map`, `leaderboard.map`, `<HallOfFameTeaser data={hallOfFameTeaserData} />`) is unchanged — it already consumed these exact local variable names.

- [ ] **Step 4: Verify**

Run: `npx vitest run lib/home/summary.test.ts` → Expected: 10 passed.
Run: `npm run test` → Expected: all green (no existing test targets `app/[locale]/page.tsx` directly, so this only catches import breakage).
Run: `npx tsc --noEmit` → clean — this is the real check that `page.tsx`'s refactor didn't drop a variable the JSX still references.
Run: `npm run build` → Expected: succeeds (a page-level refactor is worth a real Next.js build, not just `tsc`, since `tsc --noEmit` doesn't catch every SSR-only issue). **Do not run this while another session's `next dev` is active in this checkout** (memory: shared-checkout merge race) — check `git worktree list` / ask first if unsure.

- [ ] **Step 5: Wire, refresh contract, commit**

`lib/mobile-api/endpoints/index.ts` — add `import { homeEndpoint } from './home'`, append to `ALL_ENDPOINTS`.
```bash
npm run openapi
git add lib/mobile-api lib/home "app/[locale]/page.tsx" app/api/mobile openapi
git commit -m "feat(mobile-api): GET /home, extracted from the homepage's data-fetching block"
```

---

### Task 6: Ship

**Files:** none new — verification and integration only.

- [ ] **Step 1: Full verification**

Run: `npm run test` → all suites pass, including `lib/mobile-api/openapi.test.ts`'s committed-contract snapshot check.
Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → clean (ESLint runs inside `next build` too — memory: `tsc --noEmit` clean is not the same as build-clean).
Run: `npm run build` → succeeds.

- [ ] **Step 2: Merge and push**

Standing rule (memory: `feedback_always_push`): once verified, merge to `main` and push `origin/main` automatically — but **confirm this branch is based on current `origin/main`** first (`git fetch origin main && git merge-base --is-ancestor origin/main HEAD`); if not, rebase or merge `origin/main` in before merging out, since this checkout's local `main` was stale at plan-writing time.

- [ ] **Step 3: Live read-only round-trip check (no new writes exercised)**

`curl -s https://sentinelxesports.com.ng/api/mobile/v1/home` → Expected: `{"data":{"banner":...,"featuredTournament":...,...}}` with header `x-api-version: 1`.
`curl -s -X POST -o /dev/null -w "%{http_code}" https://sentinelxesports.com.ng/api/mobile/v1/session/start` → Expected: `401` (no bearer token).
`curl -s -X POST -H "content-type: application/json" -d '{"username":"a","email":"not-an-email","password":"x"}' https://sentinelxesports.com.ng/api/mobile/v1/auth/signup` → Expected: `400` with `error.code: "validation_failed"` and per-field `fields` — this proves the endpoint is live and validating **without creating an account** (a genuinely invalid body never reaches `performSignup`'s `auth.signUp` call).

**Do not** call `/auth/signup` with a valid body from this plan's verification — the spec's testing discipline (zzqa_-prefixed accounts, plus-addressed email the owner controls, logged in `TESTING-NOTES.md`, cleaned up via `anonymise_account`) applies to the *first real signup exercise*, which belongs to the mobile plan's end-to-end device test (that plan's Task 8), not a bare curl from this one.

---

## Self-Review

**Spec coverage.** Spec §2 (session/start semantics) → Task 1 (`DailyLoginResult`) + Task 2. §3.1–§3.6 (all six endpoints) → Tasks 2–5. Global Constraints' S1/S2 column-privilege facts (verified against the actual `20260918200000_...sql` migration, not assumed) → threaded through Tasks 2 (`ctx.admin` for `deletion_requested_at`), 3 (`admin.from('profiles').update` for locale), 4 (`admin.from('profiles').update` for username). §5 testing discipline → Global Constraints + Task 6 Step 3's explicit "do not call signup with a valid body here."

**Placeholder scan.** No TBD/TODO; every step has literal code or an exact shell command.

**Type consistency.** `DailyLoginResult` (Task 1) is imported unchanged by Task 2's `toSessionStartResponse`. `SignupServiceResult`/`SignupServiceErrorCode` (Task 3) match the endpoint's `SIGNUP_ERROR_MESSAGES` record exactly. `ClaimUsernameServiceResult`/`ClaimUsernameErrorCode` (Task 4) likewise. `HomeSummary`/`LeaderboardPlayer`/`HomeBanner` (Task 5) match `homeEndpoint`'s zod response shape field-for-field (camelCase throughout, matching the established `me.ts` convention).

**Known limits.** `GET /home`'s `s-maxage=30` means a brand-new banner/tournament can take up to 30s to appear on the app even after appearing on web (acceptable — pull-to-refresh bypasses it, and the endpoint is uncached on a direct hit with `cache-control` respected by Vercel's edge only, not by the client unless it implements ETag caching, which Phase 1 mobile doesn't yet). `resend-confirmation`/`request-reset` have no rate limiting beyond Supabase's own (§7.2's per-endpoint rate limiting is explicitly deferred, same as Phase 0B).
