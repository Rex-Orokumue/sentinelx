# Mobile Phase 3b (Web) — Profiles / Follow / Progress / Histories API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the player profile page, directory, followers/following lists and follow actions into shared services (behavior-neutral, proven by characterization tests), then expose them plus owner-only progress and three history lists as `/api/mobile/v1` endpoints.

**Architecture:** Two PRs, same discipline as 3a. **PR 1** (Tasks 0–5) pins the rendered element tree *and* query log of the current pages, then moves the inline data logic into `lib/players/service.ts` and `lib/follows/service.ts`; the same tests must pass unchanged afterwards. **PR 2** (Tasks 6–11) adds strict zod schemas + mappers and eleven `defineEndpoint()` endpoints on top of those services. No query shape, ranking, streak or rarity logic changes.

**Tech Stack:** Next.js 14, TypeScript, Supabase JS, zod, vitest (`include: **/*.test.ts` only — test files must be `.ts`, not `.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-24-mobile-phase3b-profiles-progress-design.md` (read fully first, especially §3, §4, §6). Also read `CLAUDE.md` (rules 8–12) and the sibling plan `2026-09-23-mobile-phase3a-web-api.md` (Tasks 0–1 define the test harness this plan reuses).

**Scope of this plan:** web repo only. The Flutter screens (spec §7) get their own plan in `sentinelx_mobile` once PR 2 merges and `openapi/mobile-v1.json` is published.

## Global Constraints

- **No behavior change in PR 1.** No query merged, dropped, reordered, cached or re-limited; the full `player_achievements` rarity scan stays; the 10-match window, 5 posts, 18 gallery images, 60-row directory cap and 100-row follower cap stay.
- **Endpoints:** always `defineEndpoint()`; route files are one line (`export const GET = xEndpoint.handler`). Never hand-write a handler under `app/api/mobile/v1/**`.
- **Public endpoints** (`/players`, `/players/{username}`, `/followers`, `/following`) use `createAnonClient()` and **must not read the bearer**; bodies are byte-identical for everyone. Viewer state ("following", "follows you") is never in them — the app derives it from `GET /me/follows`.
- **Follow runs on `ctx.userClient` (RLS)**, never the service role — the `dm_blocks` check in `player_follows_own_insert` is the block mechanism. `PUT …/follow` is `idempotent: true`.
- **History endpoints run on `ctx.userClient` and also `.eq('player_id', ctx.userId)`.** Never the service role.
- **`/me/progress` uses the service role only for** `getCoinBalance` and the DLS season-standing read, with `ctx.userId` as the only id.
- **Locked achievements are never serialized as objects** (spec §4). The mapper filters `unlocked === true` *before* mapping and never spreads a cell.
- **No `select('*')` on `profiles`.** Private columns (`phone, whatsapp_number, notification_prefs, referred_by, deletion_requested_at`) never appear in any response.
- **`sx_score_events.note` is never returned.** `reference_id` is never returned for XP or coin rows.
- **Strict schemas:** every response schema uses `.strict()`; every mapper has an exact-key-set test.
- **Migrations:** none expected. If Task 10 proves an index is needed, name it with a UTC timestamp prefix (`20260924143000_x.sql`), never a sequential number, and apply to staging (`ofxmoxpvwbemfouaowoa`) before relying on it.
- **Before every push:** `npm run lint` and `npm run build` (ESLint runs inside `next build`). Never run `npm run build` while another session's `next dev` runs in the same checkout — work in your own worktree.
- **`npm run openapi` last**, after rebasing onto current `main`; commit `openapi/mobile-v1.json`. Resolve conflicts in that file by regenerating.
- **Shared hotspots** (append-only edits): `lib/mobile-api/endpoints/index.ts`, `openapi/mobile-v1.json`, `lib/supabase/types.ts`.
- American spelling in new prose/code; existing identifiers stay.
- tsconfig has no `downlevelIteration`: use `Array.from(map.entries())` / `.forEach`, never `[...map]` / `for…of` on a `Map`/`Set`.
- Test files follow the repo's hand-rolled-fake convention; endpoint tests call `endpoint.handler(request, { params })` with `vi.hoisted` + `vi.mock('../auth', () => ({ authenticate, optionalAuth }))` (see `lib/mobile-api/endpoints/wager.test.ts` / `tournaments.test.ts`). `idempotent: true` endpoints also mock `../idempotency` as pass-through: `runIdempotent.mockImplementation(async (_a, _args, run) => run())`, and send an `idempotency-key` header.

## Facts established while planning (verified 2026-09-24)

- **`xp` IS public on the web.** `XPProgressPanel xp={p.xp}` renders for every visitor (only `coinBalance` is owner-gated). So the public profile includes `xp` and `membershipTier`; coin balance and season standing stay owner-only. (Resolves spec §11 item 2.)
- The profile page reads through the **cookie client** (`createClient()`), so an anonymous web visitor already reads as `anon` — the public endpoint's `createAnonClient()` sees the same rows. Task 7 verifies this on staging.
- The page's friendship/messaging/`isFollowing`/`followsViewer` lookups are **viewer state** and stay in the page; they are not part of `getPlayerProfile` (mobile drops friend/message; follow state comes from `/me/follows`).
- `lib/follows/query.ts` loaders call `createClient()` internally; Task 5 adds an optional `client` parameter (default unchanged) so services can inject one.
- `notifyBoth` is fire-and-forget (`void`) on web. The service takes `deps.notify` so the mobile endpoint can collect and await it (serverless may freeze un-awaited work) without changing the web action.
- Directory: `profiles` cols `username, display_name, avatar_url, sx_score, sentinel_tier, membership_tier, equipped_avatar_border`; ordered `sx_score desc`, limit 60; `neq('id', viewer)` when signed in; `.or()` ilike on username/display_name with `[%_,()]` escaped. **The web excludes the viewer from the directory.** The public endpoint cannot know the viewer, so it returns the viewer too; the app filters its own username client-side.
- Followers/following pages: `fetchFollowers/fetchFollowing(profileId, limit = 100)`, ordered `created_at desc`, no pagination (spec: "parity, not redesign"). Endpoints return the same ≤100 rows, no cursor.
- `xp_events.id`, `sx_coin_transactions` and `sx_score_events` columns: Task 10 Step 1 confirms `id` exists on all three and reads the live CHECK constraints for `source`/`event_type`.

---

## File Structure

**PR 1 (tests + extraction)**

| File | Responsibility |
|---|---|
| `lib/testing/fake-supabase.ts` (modify, 3a's) | Add `.or()` (recorded in the query log, does **not** filter — fixtures are pre-shaped) and `rpc()` (returns per-name fixture) |
| `lib/testing/profile-fixtures.ts` (create) | Profiles, achievements, player_achievements, follows, posts, matches, squads, store items |
| `app/[locale]/(public)/players/[username]/page.characterization.test.ts` (create) | Tree + query-log snapshots, 8 scenarios |
| `app/[locale]/(public)/players/page.characterization.test.ts` (create) | Directory scenarios |
| `app/[locale]/(public)/players/[username]/followers/page.characterization.test.ts` (create) | Followers + following scenarios |
| `lib/follows/service.ts` (create) | `followPlayer()` / `unfollowPlayer()` returning `{ok, created}` / `{ok:false, code}` |
| `lib/follows/service.test.ts` (create) | Unit tests |
| `lib/follows/actions.ts` (modify) | Thin wrapper: auth + `revalidatePath` + error-string mapping |
| `lib/follows/query.ts` (modify) | Optional `client` param on the loaders |
| `lib/players/service.ts` (create) | `getPlayerProfile()`, `searchPlayers()` |
| `lib/players/find-by-username.ts` (create) | `findLiveProfileByUsername(client, username)` shared by profile/followers pages and follow endpoint |
| `app/[locale]/(public)/players/**` pages (modify) | Thin callers |

**PR 2 (endpoints)**

| File | Responsibility |
|---|---|
| `lib/mobile-api/endpoints/players-schemas.ts` (create) | Strict schemas + `mapPublicProfile()`, `mapPlayerListItem()`, `mapFollowEntry()` |
| `lib/mobile-api/endpoints/players.ts` (create) | `playersSearchEndpoint`, `playerProfileEndpoint`, `playerFollowersEndpoint`, `playerFollowingEndpoint` |
| `lib/mobile-api/endpoints/follows.ts` (create) | `myFollowsEndpoint`, `followEndpoint`, `unfollowEndpoint` |
| `lib/players/progress-service.ts` (create) | `getMyProgress()` |
| `lib/mobile-api/endpoints/progress.ts` (create) | `myProgressEndpoint` |
| `lib/mobile-api/history-cursor.ts` (create) | `encodeCursor`, `decodeCursor`, `pageOf()` keyset helper |
| `lib/mobile-api/endpoints/histories.ts` (create) | `xpEventsEndpoint`, `sxScoreEventsEndpoint`, `coinTransactionsEndpoint` |
| `lib/mobile-api/endpoints/index.ts` (modify) | Append the 11 endpoints |
| `app/api/mobile/v1/**/route.ts` (create) | One-line route files |
| `*.test.ts` beside each (create) | Handler tests |

---

## PR 1 — Behavior-neutral extraction

### Task 0: Worktree, branch, baseline

**Files:** none (environment only)

- [ ] **Step 1: Choose the base.** The characterization harness (`lib/testing/*`) lives on 3a's branch until 3a merges. Check:

```bash
git fetch origin
git ls-tree -r origin/main --name-only | grep lib/testing/fake-supabase.ts || echo "3a harness NOT on main"
```

If present on `origin/main`, base on `origin/main`. Otherwise base on `origin/phase3a/web-extraction` (3a PR 1 branch). **Reuse the harness; never fork it.**

- [ ] **Step 2: Create an isolated worktree**

```bash
git worktree add ../sentinelx-p3b-web -b phase3b/web-extraction <base>
cd ../sentinelx-p3b-web
npm ci
```

- [ ] **Step 3: Confirm the suite is green before touching anything**

Run: `git worktree list` (nested worktrees make vitest double-count), then `npx vitest run 2>&1 | tail -15`
Expected: all pass. If anything is red on a clean base, stop and report.

- [ ] **Step 4: Record the cost baseline (live, staging `sentinelx-staging`)**

For `/players`, `/players/<username-of-a-player-with-achievements>`, `/players/<same>/followers`, 5 runs each, median:

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" "$STAGING_URL/players/$USERNAME"; done
```

Keep the medians for the PR 1 description (Task 5). Query counts come from the snapshots in Tasks 2–3.

---

### Task 1: Extend the harness and add profile fixtures

**Files:**
- Modify: `lib/testing/fake-supabase.ts`
- Modify: `lib/testing/fake-supabase.test.ts`
- Create: `lib/testing/profile-fixtures.ts`

**Interfaces:**
- Consumes: `fakeSupabase(tables, opts?)` from 3a.
- Produces: `fakeSupabase(tables, { user, rpc })` where `rpc?: Record<string, (args: any) => unknown>`; `PROFILE_TABLES`, `OWNER_ID`, `TARGET_ID`, `TARGET_USERNAME`, `DELETED_USERNAME`, `LOCKED_ONLY_ACHIEVEMENT_NAMES`.

- [ ] **Step 1: Write the failing tests for `.or()` and `rpc()`**

Append to `lib/testing/fake-supabase.test.ts`:

```ts
describe('fakeSupabase — or/rpc', () => {
  it('records .or() in the query log and does not filter', async () => {
    const { client, queries } = fakeSupabase({ m: [{ id: 1 }, { id: 2 }] })
    const { data } = await client.from('m').select('id').or('a.eq.1,b.eq.2')
    expect((data as unknown[]).length).toBe(2)
    expect(queries).toEqual(['m:select|or'])
  })

  it('serves rpc() from the provided map and logs it', async () => {
    const { client, queries } = fakeSupabase({}, { rpc: { player_rank: (a: { uname: string }) => (a.uname === 'x' ? 7 : null) } })
    expect((await client.rpc('player_rank', { uname: 'x' })).data).toBe(7)
    expect(queries).toEqual(['rpc:player_rank'])
  })

  it('throws on an rpc with no fixture', async () => {
    const { client } = fakeSupabase({})
    await expect(client.rpc('nope', {})).rejects.toThrow(/no rpc fixture/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/testing/fake-supabase.test.ts`
Expected: FAIL (`or` not supported / `rpc` undefined).

- [ ] **Step 3: Implement**

In `fake-supabase.ts`: read the file first. Add `or` to the set of methods that push a log segment `or` and return the chain without altering rows (mirror how `order`/`limit` are handled, but *logged*). Add to the returned client:

```ts
rpc: async (name: string, args: unknown) => {
  queries.push(`rpc:${name}`)
  const fn = opts.rpc?.[name]
  if (!fn) throw new Error(`fake-supabase: no rpc fixture for ${name}`)
  return { data: fn(args), error: null }
},
```

and extend the `opts` type with `rpc?: Record<string, (args: never) => unknown>`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/testing/fake-supabase.test.ts`
Expected: PASS (old tests still green).

- [ ] **Step 5: Write `lib/testing/profile-fixtures.ts`**

Deterministic fixtures. Must include (each row shaped exactly as the page's select would return it, including embedded relations, because the fake ignores selects):

- `profiles`: owner (`OWNER_ID`), target `TARGET_USERNAME` (`target1`), a third player, and a **deleted** player (`DELETED_USERNAME`, `deleted_at` set) — all with the full `PROFILE_COLS` set.
- `achievements`: **5 rows** (`sort_order` 1–5); `player_achievements`: target has 2 unlocked, owner has 0, third player has 3 (so rarity counts differ: one achievement held by 2 people, one by 1, one by 0 — locked-for-target ones have distinctive names such as `"Secret Locked Alpha"`). Export their names as `LOCKED_ONLY_ACHIEVEMENT_NAMES`.
- `matches`: 3 completed matches involving target (one team match with `team_a`/`team_b` embedded `{id,name}`; one whose opponent embed is `null` → "TBD"); 1 completed `round: 'final'` won by target with `tournament: { title, slug, tournament_end, game: { name } }`.
- `squad_members`: target belongs to one squad.
- `tournament_registrations` (paid) ×2 for target; `community_posts` ×3 (one with image, one `is_deleted: false`).
- `player_follows`: OWNER follows target; target follows third; third follows target.
- `games`: `dls` + one other; `seasons`: one `status: 'active'`; whatever `getSeasonLeaderboard`/`getMonthlyLeaderboard` read (reuse 3a's `SEASONS`, `GAMES`, `MATCHES`, `SNAPSHOTS` by spreading `FIXTURE_TABLES` and overriding).
- `player_store_items`, `sx_coins` (owner balance 1234).

```ts
import { FIXTURE_TABLES } from './progress-fixtures'
type Row = Record<string, unknown>

export const OWNER_ID = 'p5' // = VIEWER_ID in progress-fixtures
export const TARGET_ID = 'p1'
export const TARGET_USERNAME = 'player1'
export const DELETED_USERNAME = 'ghost'
export const LOCKED_ONLY_ACHIEVEMENT_NAMES = ['Secret Locked Alpha', 'Secret Locked Beta', 'Secret Locked Gamma']

// … build PROFILE_TABLES = { ...FIXTURE_TABLES, achievements: [...], player_achievements: [...], ... }
export const PROFILE_TABLES: Record<string, Row[]> = { /* as described above */ }
```

Reuse existing profile ids from `progress-fixtures.ts` (read it first — `PROFILES` already has `p1…pN` with all `PROFILE_COLS` except possibly `bio/country/deleted_at/xp/membership_tier/created_at`; add those fields to the rows you use rather than creating parallel profiles). Also add `rpc: { player_rank: () => 3 }` guidance as an exported `PROFILE_RPC`.

- [ ] **Step 6: Commit**

```bash
git add lib/testing
git commit -m "test: extend fake-supabase with or/rpc; add profile fixtures for 3b characterization"
```

---

### Task 2: Characterize the profile page

**Files:**
- Create: `app/[locale]/(public)/players/[username]/page.characterization.test.ts`

**Interfaces:**
- Consumes: Task 1 harness/fixtures; the page's default export and `generateMetadata`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { serializeTree } from '@/lib/testing/serialize-tree'
import { FIXTURE_NOW } from '@/lib/testing/progress-fixtures'
import { PROFILE_TABLES, PROFILE_RPC, OWNER_ID, TARGET_ID, TARGET_USERNAME, DELETED_USERNAME } from '@/lib/testing/profile-fixtures'

const state = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.fake!.client }))
// The page also hits the admin client for owner-only coin balance and season standing.
const admin = vi.hoisted(() => ({ fake: null as null | { client: unknown; queries: string[] } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin.fake!.client }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
// Viewer-state helpers not under test here (friendship + messaging are dropped on mobile):
vi.mock('@/lib/messages/query', () => ({ fetchProfileMessagingState: async () => undefined }))

import PlayerProfilePage from './page'

async function render(username: string, user: { id: string } | null) {
  state.fake = fakeSupabase(PROFILE_TABLES, { user, rpc: PROFILE_RPC }) as never
  admin.fake = fakeSupabase(PROFILE_TABLES) as never
  const tree = await PlayerProfilePage({ params: { username } })
  return { tree: serializeTree(tree), queries: state.fake!.queries, adminQueries: admin.fake!.queries }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXTURE_NOW)) })
afterEach(() => vi.useRealTimers())

describe('player profile page — characterization (pins current behavior; must not change during extraction)', () => {
  it('anonymous visitor', async () => {
    const r = await render(TARGET_USERNAME, null)
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
    expect(r.adminQueries).toEqual([]) // no owner-only reads for a visitor
  })
  it('signed-in visitor who follows the target', async () => {
    const r = await render(TARGET_USERNAME, { id: OWNER_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
  })
  it('signed-in visitor who does not follow the target', async () => {
    const r = await render(TARGET_USERNAME, { id: 'p3' })
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('target is followed by the viewer back ("follows you")', async () => {
    const r = await render('player3', { id: TARGET_ID })
    expect(r.tree).toMatchSnapshot('tree')
  })
  it('owner sees the owner-only cards', async () => {
    const r = await render('player5', { id: OWNER_ID })
    expect(r.tree).toMatchSnapshot('tree')
    expect(r.queries).toMatchSnapshot('queries')
    expect(r.adminQueries).toMatchSnapshot('adminQueries')
    expect(JSON.stringify(r.tree)).toContain('1234') // coin balance shown to the owner
  })
  it('unknown username → 404', async () => {
    await expect(render('nobody', null)).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('deleted account → 404', async () => {
    await expect(render(DELETED_USERNAME, null)).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('player with both locked and unlocked achievements', async () => {
    const r = await render(TARGET_USERNAME, null)
    const json = JSON.stringify(r.tree)
    expect(json).toContain('Locked') // AchievementsGrid renders 🔒 Locked
  })
  it('fixtures exercise the interesting paths (guards against a vacuous snapshot)', async () => {
    const json = JSON.stringify((await render(TARGET_USERNAME, null)).tree)
    expect(json).toContain('TBD') // null opponent embed
    expect(json).toContain(TARGET_USERNAME)
  })
})
```

- [ ] **Step 2: Run it to record snapshots**

Run: `npx vitest run "app/[locale]/(public)/players/[username]/page.characterization.test.ts"`
Expected: PASS; snapshots written. If the fake throws "not supported", add exactly the missing method to `fake-supabase.ts` (with a test) — nothing else.

- [ ] **Step 3: Re-run to prove the snapshots are stable**

Run the same command again. Expected: PASS with no writes (`git status` shows the snapshot unchanged). Read the snapshot file once: confirm it is not vacuous (contains stats, achievements, the match rows).

- [ ] **Step 4: Record the query count**

Count entries in the `queries` snapshot for the anonymous scenario; write "profile page (anon): N queries" for the PR description.

- [ ] **Step 5: Commit**

```bash
git add "app/[locale]/(public)/players/[username]"
git commit -m "test: characterize the player profile page (tree + query log) before extraction"
```

---

### Task 3: Characterize the directory and followers/following pages

**Files:**
- Create: `app/[locale]/(public)/players/page.characterization.test.ts`
- Create: `app/[locale]/(public)/players/[username]/followers/page.characterization.test.ts`

- [ ] **Step 1: Directory test** (same header/mocks as Task 2 minus admin/rpc)

```ts
import PlayersPage from './page'
async function render(searchParams: { q?: string }, user: { id: string } | null) {
  state.fake = fakeSupabase(PROFILE_TABLES, { user }) as never
  const tree = await PlayersPage({ searchParams })
  return { tree: serializeTree(tree), queries: state.fake!.queries }
}
// scenarios: no q anonymous; no q signed in (viewer excluded → 'neq' in query log);
// q="play"; q with wildcard chars q="50%_,(x)" (log shows the single 'or');
// q that matches nothing is NOT distinguishable with the fake (or() doesn't filter) — assert only the log.
```

Write the four `it()` blocks with `toMatchSnapshot('tree')` and `toMatchSnapshot('queries')`.

- [ ] **Step 2: Followers/following test.** The followers page and its sibling `following/page.tsx` share the shape in the spec. Render both defaults for: anonymous, signed-in (uses `fetchFollowerIds` → "Follows you" tags), unknown username (404), deleted username (404), empty list (EmptyState).

```ts
import FollowersPage from './page'
import FollowingPage from '../following/page'
// fixtures: the embedded shape the loaders read is `{ follower: {id, username, display_name, avatar_url, membership_tier} }` —
// add `follower`/`following` embedded objects onto the player_follows fixture rows in profile-fixtures.ts.
```

- [ ] **Step 3: Run twice (record, then stability check)**

Run: `npx vitest run "app/[locale]/(public)/players"`
Expected: PASS both times; second run writes nothing.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/players" lib/testing
git commit -m "test: characterize players directory and followers/following pages"
```

---

### Task 4: Extract the follow service

**Files:**
- Create: `lib/follows/service.ts`, `lib/follows/service.test.ts`
- Modify: `lib/follows/actions.ts`

**Interfaces:**
- Produces:

```ts
export type FollowErrorCode = 'self' | 'blocked' | 'error'
export type FollowResult = { ok: true; created: boolean } | { ok: false; code: FollowErrorCode }
export interface FollowDeps { notify: (userId: string, payload: { type: 'new_follower'; followerName: string }, prefKey: 'new_follower', opts: { link?: string }) => unknown }
export function followPlayer(client: SupabaseClient, followerId: string, targetId: string, deps: FollowDeps): Promise<FollowResult>
export function unfollowPlayer(client: SupabaseClient, followerId: string, targetId: string): Promise<{ ok: true } | { ok: false; code: 'error' }>
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/follows/service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { followPlayer, unfollowPlayer } from './service'

function client(opts: { upserted?: { follower_id: string }[] | null; error?: { code: string } | null; me?: { display_name: string | null; username: string | null } | null }) {
  const upsert = vi.fn(() => ({ select: async () => ({ data: opts.upserted ?? null, error: opts.error ?? null }) }))
  const del = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: opts.error ?? null }) }) }))
  return {
    upsert, del,
    from: (t: string) => t === 'player_follows'
      ? { upsert, delete: del }
      : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.me ?? null }) }) }) },
  } as never
}

describe('followPlayer', () => {
  it('rejects self-follow without touching the DB', async () => {
    const c = client({})
    const notify = vi.fn()
    expect(await followPlayer(c, 'a', 'a', { notify })).toEqual({ ok: false, code: 'self' })
    expect(notify).not.toHaveBeenCalled()
  })
  it('creates a follow and notifies exactly once', async () => {
    const notify = vi.fn()
    const c = client({ upserted: [{ follower_id: 'a' }], me: { display_name: 'Ada', username: 'ada' } })
    expect(await followPlayer(c, 'a', 'b', { notify })).toEqual({ ok: true, created: true })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('b', { type: 'new_follower', followerName: 'Ada' }, 'new_follower', { link: '/players/ada' })
  })
  it('a duplicate follow reports created:false and does NOT notify', async () => {
    const notify = vi.fn()
    const c = client({ upserted: [] })
    expect(await followPlayer(c, 'a', 'b', { notify })).toEqual({ ok: true, created: false })
    expect(notify).not.toHaveBeenCalled()
  })
  it('maps RLS 42501 to blocked', async () => {
    expect(await followPlayer(client({ error: { code: '42501' } }), 'a', 'b', { notify: vi.fn() })).toEqual({ ok: false, code: 'blocked' })
  })
  it('maps any other error to error', async () => {
    expect(await followPlayer(client({ error: { code: 'XX000' } }), 'a', 'b', { notify: vi.fn() })).toEqual({ ok: false, code: 'error' })
  })
  it('falls back to "Someone" when the follower has no name', async () => {
    const notify = vi.fn()
    await followPlayer(client({ upserted: [{ follower_id: 'a' }], me: null }), 'a', 'b', { notify })
    expect(notify.mock.calls[0][1]).toEqual({ type: 'new_follower', followerName: 'Someone' })
    expect(notify.mock.calls[0][3]).toEqual({ link: undefined })
  })
})

describe('unfollowPlayer', () => {
  it('ok on success, error on failure', async () => {
    expect(await unfollowPlayer(client({}), 'a', 'b')).toEqual({ ok: true })
    expect(await unfollowPlayer(client({ error: { code: 'x' } }), 'a', 'b')).toEqual({ ok: false, code: 'error' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/follows/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/follows/service.ts`** — the body of today's `followPlayer`/`unfollowPlayer` moved verbatim (same upsert options, same `.select('follower_id')` trick and its comment, same `me` lookup and `'Someone'` fallback), using `canFollow` from `./predicates`, returning the result types above, and calling `deps.notify(targetId, { type: 'new_follower', followerName }, 'new_follower', { link })` **without awaiting** only when `upserted && upserted.length > 0`.

- [ ] **Step 4: Rewrite `lib/follows/actions.ts` as a thin wrapper**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyBoth } from '@/lib/notifications/send'
import { followPlayer as follow, unfollowPlayer as unfollow } from './service'

const FOLLOW_ERRORS = { self: 'You cannot follow yourself.', blocked: 'You cannot follow this player.', error: 'Could not follow this player.' } as const

async function authed() { /* unchanged */ }

export async function followPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const r = await follow(supabase, userId, profileId, { notify: (id, p, k, o) => void notifyBoth(id, p, k, o) })
  if (!r.ok) return { error: FOLLOW_ERRORS[r.code] }
  revalidatePath('/community')
  return {}
}

export async function unfollowPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const r = await unfollow(supabase, userId, profileId)
  if (!r.ok) return { error: 'Could not unfollow this player.' }
  revalidatePath('/community')
  return {}
}
```

The error strings above must equal today's exactly (self-follow text comes from `canFollow`; keep it in one place — have the wrapper reuse `canFollow(...).error` if you prefer, but the returned strings must not change). Confirm `notifyBoth`'s real parameter types with `npx tsc --noEmit` and adjust `FollowDeps.notify`'s type to `typeof notifyBoth`-compatible.

- [ ] **Step 5: Run the tests, typecheck, and the Task 2/3 characterization tests**

Run: `npx tsc --noEmit && npx vitest run lib/follows "app/[locale]/(public)/players"`
Expected: all PASS, snapshots unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/follows
git commit -m "refactor(follows): extract follow/unfollow into a client-injected service"
```

---

### Task 5: Extract the players service and thin the pages

**Files:**
- Create: `lib/players/find-by-username.ts`, `lib/players/service.ts`, `lib/players/service.test.ts`
- Modify: `lib/follows/query.ts`, the three page files under `app/[locale]/(public)/players/`

**Interfaces:**
- Consumes: Task 4 nothing; Task 1 fixtures.
- Produces:

```ts
// find-by-username.ts
export async function findLiveProfileByUsername<T>(client: SupabaseClient, username: string, cols: string): Promise<T | null> // null when absent OR deleted_at set

// service.ts
export interface PlayerProfileData {
  profile: ProfileView                      // lib/players/profile.ts, unchanged
  xp: number
  matches: ProfileMatch[]
  titles: ProfileTitle[]
  gamesPlayed: { name: string; wins: number; matches: number }[]
  achievementCells: AchievementCell[]        // ALL cells, locked included — the mapper (PR 2) filters
  unlockedSlugs: string[]
  cosmetics: ReturnType<typeof equippedCosmeticsBySlug>
  posts: { id: string; content: string; postType: string; createdAt: string }[]
  gallery: { id: string; imageUrl: string }[]
  isOwner: boolean
  ownerOnly: { coinBalance: number; seasonStanding: SeasonStanding | null } | null
  publicSeasonRank: number | null
}
export interface SeasonStanding { rank: number | null; points: number; pointsAtRankSixteen: number; monthlyRank: number | null; monthlyPoints: number }
export async function getPlayerProfile(supabase: SupabaseClient, admin: AdminClient, username: string, viewerId: string | null): Promise<PlayerProfileData | null>
export async function searchPlayers(supabase: SupabaseClient, q: string, excludeId: string | null): Promise<PlayerCardData[]>
```

- [ ] **Step 1: Give the follow loaders an injectable client** (behavior-neutral)

In `lib/follows/query.ts` change each loader to `async function fetchX(…args, client = createClient())` — for example `fetchFollowCounts(profileId: string, client = createClient())` and replace the internal `const supabase = createClient()` with `const supabase = client`. Existing callers pass nothing → unchanged. Run the Task 3 tests: unchanged.

- [ ] **Step 2: Write a failing service test** (`lib/players/service.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, PROFILE_RPC, OWNER_ID, TARGET_USERNAME, DELETED_USERNAME } from '@/lib/testing/profile-fixtures'
import { getPlayerProfile, searchPlayers } from './service'

const sb = (user: { id: string } | null = null) => fakeSupabase(PROFILE_TABLES, { user, rpc: PROFILE_RPC }).client as never
const admin = () => fakeSupabase(PROFILE_TABLES).client as never

describe('getPlayerProfile', () => {
  it('returns null for an unknown username', async () => {
    expect(await getPlayerProfile(sb(), admin(), 'nobody', null)).toBeNull()
  })
  it('returns null for a deleted account', async () => {
    expect(await getPlayerProfile(sb(), admin(), DELETED_USERNAME, null)).toBeNull()
  })
  it('a visitor gets no owner-only data', async () => {
    const r = await getPlayerProfile(sb(), admin(), TARGET_USERNAME, null)
    expect(r!.isOwner).toBe(false)
    expect(r!.ownerOnly).toBeNull()
  })
  it('the owner gets coin balance and season standing', async () => {
    const r = await getPlayerProfile(sb(), admin(), 'player5', OWNER_ID)
    expect(r!.isOwner).toBe(true)
    expect(r!.ownerOnly!.coinBalance).toBe(1234)
  })
  it('computes the streak from the last-10 window and keeps ALL achievement cells', async () => {
    const r = await getPlayerProfile(sb(), admin(), TARGET_USERNAME, null)
    expect(r!.achievementCells.length).toBe(5)
    expect(r!.unlockedSlugs.length).toBe(2)
  })
})
```

Adjust expected values to what the fixtures produce (compute from the fixtures, do not guess). Run → FAIL (module missing).

- [ ] **Step 3: Implement `find-by-username.ts` and `service.ts`**

Move the page's logic **verbatim** into `getPlayerProfile`: `PROFILE_COLS`, `loadProfile` (with the deleted-account filter and its comment), squad-id lookup, the 13-way `Promise.all` in the same order, category stats, `gamesPlayed`, matches, streak, rarity map, `buildAchievementCells`, posts/gallery mapping, titles (`toBracketFinal` moves too), the season standing block. Rules:

- `viewerId` replaces `user?.id`; `isOwner = viewerId === p.id`.
- Owner-only reads (`getCoinBalance(admin, …)`, monthly leaderboard) stay gated by `isOwner` exactly as today; the public `seasonRank` computation (needs the admin client for `getSeasonLeaderboard` even for visitors, as today) stays unconditional — `getPlayerProfile` therefore always needs `admin`. Keep call **order** identical (the query-log snapshots enforce it).
- Friendship, messaging, `fetchIsFollowing` stay in the page.
- `searchPlayers(supabase, q, excludeId)` = the directory's query block verbatim (`PLAYER_COLS`, `sx_score desc`, `limit(60)`, `neq('id', excludeId)` only when non-null, the `[%_,()]` escape and `.or(...)`).

- [ ] **Step 4: Convert the pages to thin callers**

`players/[username]/page.tsx`: `generateMetadata` uses `findLiveProfileByUsername`; the default export calls `getPlayerProfile(supabase, createAdminClient(), params.username, user?.id ?? null)`, `notFound()` on null, then does the viewer-state lookups it does today and renders the **identical JSX** from the returned data. Same for the directory (`searchPlayers`) and followers/following pages (`findLiveProfileByUsername` with cols `'id, username, display_name, deleted_at'`).

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: service tests PASS; **all Task 2/3 characterization snapshots unchanged** (`git status` clean for `__snapshots__`). If a snapshot differs, the extraction changed behavior — fix the extraction, never the snapshot. A changed query-log order counts as a difference.

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 7: Commit and open PR 1**

```bash
git add lib app
git commit -m "refactor(players): extract profile, directory and follow lists into services"
git push -u origin phase3b/web-extraction
```

PR 1 description must include: the Task 0 live timings (before) and Task 2 query count, the sentence "rarity full-scan unchanged", and the same timings re-measured on the preview. Merge only with snapshots untouched after first recording.

---

## PR 2 — Mobile endpoints

Start a fresh branch `phase3b/web-endpoints` from `main` after PR 1 merges (rebase if 3a's endpoint PR landed first).

### Task 6: Schemas and mappers (locked-achievement guarantee first)

**Files:**
- Create: `lib/mobile-api/endpoints/players-schemas.ts`, `lib/mobile-api/endpoints/players-schemas.test.ts`

**Interfaces:**
- Consumes: `PlayerProfileData` from `lib/players/service`.
- Produces: `publicProfileSchema`, `playerListItemSchema`, `followEntrySchema` (all `.strict()`), `mapPublicProfile(d: PlayerProfileData, ctx: { username: string })`, `mapPlayerListItem(row)`, `mapFollowEntry(e: FollowListEntry)`.

- [ ] **Step 1: Write the failing locked-achievement test — this is the first test of the mapper**

```ts
// lib/mobile-api/endpoints/players-schemas.test.ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, PROFILE_RPC, TARGET_USERNAME } from '@/lib/testing/profile-fixtures'
import { getPlayerProfile } from '@/lib/players/service'
import { mapPublicProfile, publicProfileSchema } from './players-schemas'

async function mapped() {
  const sb = fakeSupabase(PROFILE_TABLES, { rpc: PROFILE_RPC }).client as never
  const admin = fakeSupabase(PROFILE_TABLES).client as never
  const data = await getPlayerProfile(sb, admin, TARGET_USERNAME, null)
  return { data: data!, out: publicProfileSchema.parse(mapPublicProfile(data!, { username: TARGET_USERNAME })) }
}

describe('mapPublicProfile — locked achievements never leave the server', () => {
  it('the serialized body contains no locked achievement name, description or slug', async () => {
    const { data, out } = await mapped()
    const body = JSON.stringify(out)
    const unlocked = new Set(data.achievementCells.filter((c) => c.unlocked).map((c) => c.slug))
    const locked = data.achievementCells.filter((c) => !unlocked.has(c.slug))
    expect(locked.length).toBeGreaterThan(0) // guard: fixture really has locked ones
    for (const c of locked) {
      expect(body).not.toContain(c.name)
      expect(body).not.toContain(c.description)
      expect(body).not.toContain(c.slug)
    }
  })
  it('sends only counts for locked ones', async () => {
    const { data, out } = await mapped()
    expect(out.achievements.total).toBe(data.achievementCells.length)
    expect(out.achievements.unlockedCount).toBe(out.achievements.unlocked.length)
  })
  it('unlocked list is in rarity order and showcase is the top-3 subset', async () => {
    const { out } = await mapped()
    const counts = out.achievements.unlocked.map((a) => a.unlockCount)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(out.achievements.showcase.every((s) => out.achievements.unlocked.some((u) => u.slug === s))).toBe(true)
    expect(out.achievements.showcase.length).toBeLessThanOrEqual(3)
  })
})

describe('mapPublicProfile — key sets', () => {
  it('has exactly the documented top-level and nested keys', async () => {
    const { out } = await mapped()
    expect(Object.keys(out).sort()).toEqual(['achievements', 'gallery', 'player', 'posts', 'recentMatches', 'stats', 'titles'])
    expect(Object.keys(out.player).sort()).toEqual([
      'avatarUrl', 'bio', 'country', 'createdAt', 'displayName', 'frameUrl', 'id', 'membershipTier',
      'sentinelTier', 'sxScore', 'username', 'xp',
    ])
    expect(Object.keys(out.stats).sort()).toEqual([
      'categoryStats', 'currentStreak', 'followerCount', 'followingCount', 'goalsConceded', 'goalsScored',
      'losses', 'rank', 'totalMatches', 'totalRankedPlayers', 'totalTitles', 'tournamentsPlayed', 'wins',
    ])
    expect(Object.keys(out.achievements).sort()).toEqual(['showcase', 'total', 'unlocked', 'unlockedCount'])
  })
  it('never carries private columns or owner-only data', async () => {
    const body = JSON.stringify((await mapped()).out)
    for (const k of ['phone', 'whatsapp', 'notification_prefs', 'referred', 'deletion', 'coinBalance', 'monthly']) {
      expect(body.toLowerCase()).not.toContain(k.toLowerCase())
    }
  })
  it('the strict schema rejects an extra key', async () => {
    const { out } = await mapped()
    expect(() => publicProfileSchema.parse({ ...out, viewerFollows: true })).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/mobile-api/endpoints/players-schemas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/mobile-api/endpoints/players-schemas.ts
import { z } from 'zod'
import { topShowcase } from '@/lib/players/achievement-rarity'
import { AVATAR_BORDER_FRAMES } from '@/lib/store/cosmetics'
import type { PlayerProfileData } from '@/lib/players/service'

const nullableStr = z.string().nullable()

export const publicProfileSchema = z.object({
  player: z.object({
    id: z.string(), username: z.string(), displayName: nullableStr, avatarUrl: nullableStr, frameUrl: nullableStr,
    country: nullableStr, bio: nullableStr, createdAt: nullableStr, sxScore: z.number(), sentinelTier: nullableStr,
    membershipTier: z.string(), xp: z.number(),
  }).strict(),
  stats: z.object({
    totalMatches: z.number(), wins: z.number(), losses: z.number(), goalsScored: z.number(), goalsConceded: z.number(),
    totalTitles: z.number(), tournamentsPlayed: z.number(), currentStreak: z.number(),
    rank: z.number().nullable(), totalRankedPlayers: z.number().nullable(),
    followerCount: z.number(), followingCount: z.number(),
    categoryStats: z.array(z.object({ category: z.string(), scored: z.number(), conceded: z.number() }).strict()),
  }).strict(),
  titles: z.array(z.object({ tournamentTitle: z.string(), tournamentSlug: z.string(), gameName: nullableStr, date: nullableStr }).strict()),
  recentMatches: z.array(z.object({
    id: z.string(), opponentName: z.string(), playerScore: z.number(), opponentScore: z.number(),
    outcome: z.enum(['win', 'loss', 'draw']), tournamentTitle: nullableStr, completedAt: nullableStr,
  }).strict()),
  achievements: z.object({
    total: z.number(), unlockedCount: z.number(),
    unlocked: z.array(z.object({
      slug: z.string(), name: z.string(), description: z.string(), category: z.string(),
      unlockedAt: z.string(), unlockCount: z.number(),
    }).strict()),
    showcase: z.array(z.string()),
  }).strict(),
  posts: z.array(z.object({ id: z.string(), content: z.string(), postType: z.string(), createdAt: z.string() }).strict()),
  gallery: z.array(z.object({ id: z.string(), imageUrl: z.string() }).strict()),
}).strict()

export function mapPublicProfile(d: PlayerProfileData, _ctx: { username: string }): z.input<typeof publicProfileSchema> {
  const p = d.profile
  // Filter FIRST and rebuild each object field by field: a locked cell must never be reachable from the output,
  // and no spread means a future field on AchievementCell can never leak by accident.
  const unlockedCells = d.achievementCells.filter((c) => c.unlocked)
  const showcase = topShowcase(d.achievementCells, 3).map((c) => c.slug)
  // Rarity order = the same comparator topShowcase uses (rarest first, ties by newest unlock).
  const ordered = unlockedCells.slice().sort((a, b) =>
    a.unlockCount !== b.unlockCount ? a.unlockCount - b.unlockCount
      : new Date(b.unlockedAt!).getTime() - new Date(a.unlockedAt!).getTime())
  return {
    player: {
      id: p.id, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl,
      frameUrl: d.cosmetics.avatarBorder ? AVATAR_BORDER_FRAMES[d.cosmetics.avatarBorder] ?? null : null,
      country: p.country, bio: p.bio, createdAt: p.createdAt, sxScore: p.sxScore, sentinelTier: p.sentinelTier,
      membershipTier: p.membershipTier, xp: d.xp,
    },
    stats: {
      totalMatches: p.totalMatches, wins: p.wins, losses: p.losses, goalsScored: p.goalsScored,
      goalsConceded: p.goalsConceded, totalTitles: p.totalTitles, tournamentsPlayed: p.tournamentsPlayed,
      currentStreak: p.currentStreak, rank: p.rank, totalRankedPlayers: p.totalRankedPlayers,
      followerCount: p.followerCount, followingCount: p.followingCount,
      categoryStats: p.categoryStats.map((c) => ({ category: c.category, scored: c.scored, conceded: c.conceded })),
    },
    titles: d.titles.map((t) => ({ tournamentTitle: t.tournamentTitle, tournamentSlug: t.tournamentSlug, gameName: t.gameName, date: t.date })),
    recentMatches: d.matches.map((m) => ({
      id: m.id, opponentName: m.opponentName, playerScore: m.playerScore, opponentScore: m.opponentScore,
      outcome: m.outcome, tournamentTitle: m.tournamentTitle, completedAt: m.completedAt,
    })),
    achievements: {
      total: d.achievementCells.length,
      unlockedCount: unlockedCells.length,
      unlocked: ordered.map((c) => ({
        slug: c.slug, name: c.name, description: c.description, category: c.category,
        unlockedAt: c.unlockedAt as string, unlockCount: c.unlockCount,
      })),
      showcase,
    },
    posts: d.posts.map((x) => ({ id: x.id, content: x.content, postType: x.postType, createdAt: x.createdAt })),
    gallery: d.gallery.map((g) => ({ id: g.id, imageUrl: g.imageUrl })),
  }
}
```

Also add `playerListItemSchema` (`username, displayName, avatarUrl, sxScore, sentinelTier, membershipTier, equippedAvatarBorder`), `followEntrySchema` (`id, username, displayName, avatarUrl, membershipTier`) and their `map*` functions with the same `.strict()` + key-set tests. **Before finalizing `frameUrl`,** read `components/player/ProfileHeader.tsx` and `lib/store/cosmetics.ts`: mirror exactly which cosmetics the header renders (avatar frame, profile theme class, username colour class). If the web header renders theme/username-colour, expose them as `themeSlug`/`usernameColourSlug` (slugs, not CSS classes) in `player` and add them to the key-set test; do not add other cosmetics.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/mobile-api/endpoints/players-schemas.test.ts`
Expected: PASS. If `AVATAR_BORDER_FRAMES` indexing or `d.cosmetics` types differ, fix with the real types from `lib/store/cosmetics.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/mobile-api/endpoints/players-schemas.ts lib/mobile-api/endpoints/players-schemas.test.ts
git commit -m "feat(mobile-api): strict player schemas + mappers with locked-achievement guarantee"
```

---

### Task 7: Public endpoints — search, profile, followers, following

**Files:**
- Create: `lib/mobile-api/endpoints/players.ts`, `lib/mobile-api/endpoints/players.test.ts`
- Create: `app/api/mobile/v1/players/route.ts`, `app/api/mobile/v1/players/[username]/route.ts`, `app/api/mobile/v1/players/[username]/followers/route.ts`, `app/api/mobile/v1/players/[username]/following/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: `searchPlayers`, `getPlayerProfile`, `findLiveProfileByUsername`, `fetchFollowers`, `fetchFollowing` (client-injected, Task 5), the Task 6 mappers.
- Produces: `playersSearchEndpoint`, `playerProfileEndpoint`, `playerFollowersEndpoint`, `playerFollowingEndpoint`. All `auth: 'public'`, `cacheControl: 'public, s-maxage=60, stale-while-revalidate=120'`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/mobile-api/endpoints/players.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { PROFILE_TABLES, PROFILE_RPC, TARGET_USERNAME, DELETED_USERNAME } from '@/lib/testing/profile-fixtures'

const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const anon = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../anon-client', () => ({ createAnonClient: () => anon.client }))
const admin = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin.client }))

import { playersSearchEndpoint, playerProfileEndpoint, playerFollowersEndpoint, playerFollowingEndpoint } from './players'

const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://x.test/api/mobile/v1${path}`, { headers })

beforeEach(() => {
  anon.client = fakeSupabase(PROFILE_TABLES, { rpc: PROFILE_RPC }).client
  admin.client = fakeSupabase(PROFILE_TABLES).client
  optionalAuth.mockResolvedValue(null)
})

describe('GET /players/{username}', () => {
  it('returns the profile with a 60s public cache', async () => {
    const res = await playerProfileEndpoint.handler(req(`/players/${TARGET_USERNAME}`), { params: { username: TARGET_USERNAME } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    expect((await res.json()).data.player.username).toBe(TARGET_USERNAME)
  })
  it('404s for an unknown username', async () => {
    const res = await playerProfileEndpoint.handler(req('/players/nobody'), { params: { username: 'nobody' } })
    expect(res.status).toBe(404)
  })
  it('404s for a deleted account', async () => {
    const res = await playerProfileEndpoint.handler(req(`/players/${DELETED_USERNAME}`), { params: { username: DELETED_USERNAME } })
    expect(res.status).toBe(404)
  })
  it('body is byte-identical with and without an Authorization header', async () => {
    const a = await (await playerProfileEndpoint.handler(req(`/players/${TARGET_USERNAME}`), { params: { username: TARGET_USERNAME } })).text()
    optionalAuth.mockResolvedValue({ userId: 'p5', userClient: {}, admin: {} }) // even if auth resolves, the handler must not use it
    const b = await (await playerProfileEndpoint.handler(req(`/players/${TARGET_USERNAME}`, { authorization: 'Bearer x' }), { params: { username: TARGET_USERNAME } })).text()
    expect(b).toBe(a)
  })
  it('contains no private-column names', async () => {
    const body = await (await playerProfileEndpoint.handler(req(`/players/${TARGET_USERNAME}`), { params: { username: TARGET_USERNAME } })).text()
    expect(body).not.toMatch(/whatsapp|phone|notification_prefs|referred|deletion/i)
  })
})

describe('GET /players?q=', () => {
  it('returns list items in the strict shape', async () => {
    const res = await playersSearchEndpoint.handler(req('/players?q=play'), { params: {} })
    expect(res.status).toBe(200)
    const items = (await res.json()).data
    expect(Array.isArray(items)).toBe(true)
    expect(Object.keys(items[0]).sort()).toEqual(['avatarUrl', 'displayName', 'equippedAvatarBorder', 'membershipTier', 'sentinelTier', 'sxScore', 'username'])
  })
})

describe('followers / following', () => {
  it('404 for unknown, entries strict for known', async () => {
    expect((await playerFollowersEndpoint.handler(req('/players/nobody/followers'), { params: { username: 'nobody' } })).status).toBe(404)
    const res = await playerFollowersEndpoint.handler(req(`/players/${TARGET_USERNAME}/followers`), { params: { username: TARGET_USERNAME } })
    const items = (await res.json()).data
    expect(Object.keys(items[0]).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'membershipTier', 'username'])
    expect((await playerFollowingEndpoint.handler(req(`/players/${TARGET_USERNAME}/following`), { params: { username: TARGET_USERNAME } })).status).toBe(200)
  })
})
```

The response for the list endpoints is a bare array under `data` (matching the web: ≤60 / ≤100 rows, no cursor). Note in the OpenAPI `summary` that the viewer is not excluded from `/players` (web excludes the signed-in viewer; the app filters its own username).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/mobile-api/endpoints/players.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `players.ts`**

```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { createAnonClient } from '../anon-client'
import { Errors } from '../errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlayerProfile, searchPlayers } from '@/lib/players/service'
import { findLiveProfileByUsername } from '@/lib/players/find-by-username'
import { fetchFollowers, fetchFollowing } from '@/lib/follows/query'
import { publicProfileSchema, playerListItemSchema, followEntrySchema, mapPublicProfile, mapPlayerListItem, mapFollowEntry } from './players-schemas'

const CACHE = 'public, s-maxage=60, stale-while-revalidate=120'

export const playersSearchEndpoint = defineEndpoint({
  operationId: 'searchPlayers',
  method: 'GET',
  path: '/players',
  summary: 'Player directory search (max 60, ranked by SX Score). Public; does not exclude the caller — the app filters its own username.',
  auth: 'public',
  cacheControl: CACHE,
  response: z.array(playerListItemSchema),
  handler: async ({ req }) => {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 64)
    return (await searchPlayers(createAnonClient(), q, null)).map(mapPlayerListItem)
  },
})

export const playerProfileEndpoint = defineEndpoint({
  operationId: 'getPlayerProfile',
  method: 'GET',
  path: '/players/{username}',
  summary: 'Public player profile. 404 for unknown and deleted accounts. Identical for every caller.',
  auth: 'public',
  cacheControl: CACHE,
  response: publicProfileSchema,
  handler: async ({ params }) => {
    const data = await getPlayerProfile(createAnonClient(), createAdminClient(), params.username, null)
    if (!data) throw Errors.notFound()
    return mapPublicProfile(data, { username: params.username })
  },
})

async function listFor(kind: 'followers' | 'following', username: string) {
  const client = createAnonClient()
  const p = await findLiveProfileByUsername<{ id: string }>(client, username, 'id, username, display_name, deleted_at')
  if (!p) throw Errors.notFound()
  const entries = kind === 'followers' ? await fetchFollowers(p.id, 100, client) : await fetchFollowing(p.id, 100, client)
  return entries.map(mapFollowEntry)
}

export const playerFollowersEndpoint = defineEndpoint({
  operationId: 'getPlayerFollowers', method: 'GET', path: '/players/{username}/followers',
  summary: 'Who follows this player (max 100, newest first). Public.', auth: 'public', cacheControl: CACHE,
  response: z.array(followEntrySchema), handler: async ({ params }) => listFor('followers', params.username),
})
export const playerFollowingEndpoint = defineEndpoint({
  operationId: 'getPlayerFollowing', method: 'GET', path: '/players/{username}/following',
  summary: 'Who this player follows (max 100, newest first). Public.', auth: 'public', cacheControl: CACHE,
  response: z.array(followEntrySchema), handler: async ({ params }) => listFor('following', params.username),
})
```

Two notes: (1) `getPlayerProfile` needs `viewerId = null` so **no** owner-only branch can run on the public path — the admin client is passed only because the public `seasonRank` read needs it (as on the web); (2) `fetchFollowers/fetchFollowing` signature is `(profileId, limit = 100, client = createClient())` — update Task 5's loaders to that order if not already. `Errors.notFound` — confirm the exact factory name in `lib/mobile-api/errors.ts` (bracket.ts uses `Errors.notFound()`).

- [ ] **Step 4: Route files and registry**

Each route file: `import { xEndpoint } from '@/lib/mobile-api/endpoints/players'; export const GET = xEndpoint.handler`. Append the four endpoints to `ALL_ENDPOINTS` in `index.ts`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run lib/mobile-api`
Expected: PASS (including `openapi.test.ts`, which walks `ALL_ENDPOINTS`).

- [ ] **Step 6: Commit**

```bash
git add lib/mobile-api app/api/mobile/v1/players
git commit -m "feat(mobile-api): public player endpoints (search, profile, followers, following)"
```

---

### Task 8: Follow endpoints and `GET /me/follows`

**Files:**
- Create: `lib/mobile-api/endpoints/follows.ts`, `lib/mobile-api/endpoints/follows.test.ts`
- Create: `app/api/mobile/v1/me/follows/route.ts`, `app/api/mobile/v1/players/[username]/follow/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`

**Interfaces:**
- Consumes: Task 4's `followPlayer`/`unfollowPlayer` service, `findLiveProfileByUsername`, `fetchFollowingIds`/`fetchFollowerIds` (client-injected).
- Produces: `myFollowsEndpoint` (GET, user), `followEndpoint` (PUT, user, `idempotent: true`), `unfollowEndpoint` (DELETE, user). The route file `players/[username]/follow/route.ts` exports **both** `PUT` and `DELETE`.

- [ ] **Step 1: Write the failing tests**

```ts
// follows.test.ts (key cases — write all)
const { authenticate, optionalAuth } = vi.hoisted(() => ({ authenticate: vi.fn(), optionalAuth: vi.fn() }))
vi.mock('../auth', () => ({ authenticate, optionalAuth }))
const { runIdempotent } = vi.hoisted(() => ({ runIdempotent: vi.fn() }))
vi.mock('../idempotency', () => ({ runIdempotent }))
const { notifyBoth } = vi.hoisted(() => ({ notifyBoth: vi.fn(async () => undefined) }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth }))

beforeEach(() => { runIdempotent.mockImplementation(async (_a: unknown, _args: unknown, run: () => unknown) => run()); notifyBoth.mockClear() })

// helper: ctx with a fakeSupabase userClient whose player_follows.upsert().select() yields `upserted`
// and whose profiles lookup resolves TARGET / DELETED / null.

it('PUT creates a follow: 200 {following:true, created:true}, one notification, awaited before responding')
it('PUT on an existing follow: created:false and NO notification')
it('PUT self-follow: 400 cannot_follow_self')
it('PUT blocked (RLS 42501): 403 follow_blocked')
it('PUT unknown username: 404; deleted username: 404')
it('PUT without an idempotency-key header: 400 idempotency_key_required') // default from defineEndpoint
it('a replayed request (runIdempotent returns the stored outcome without calling run) fires NOTHING', async () => {
  runIdempotent.mockResolvedValue({ status: 200, body: { data: { following: true, created: true } } })
  // …call handler; expect(notifyBoth).not.toHaveBeenCalled(); response body equals the stored one
})
it('the follow uses ctx.userClient, never ctx.admin', async () => {
  // give ctx.admin a Proxy that throws on any property access; the test passes only if never touched
  // (runIdempotent is mocked, so it does not touch admin either)
})
it('DELETE: 200 {following:false}; unknown → 404; DB error → 500')
it('GET /me/follows returns exactly {followingIds, followerIds} and is no-store')
```

Fill every `it` with real assertions (status + body + `notifyBoth` call counts). The "awaited before responding" case: make `notifyBoth` a promise that flips a flag when it resolves after a `setTimeout(0)`; assert the flag is true by the time `handler()` resolves.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/mobile-api/endpoints/follows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/mobile-api/endpoints/follows.ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import { followPlayer, unfollowPlayer } from '@/lib/follows/service'
import { findLiveProfileByUsername } from '@/lib/players/find-by-username'
import { fetchFollowingIds, fetchFollowerIds } from '@/lib/follows/query'
import { notifyBoth } from '@/lib/notifications/send'

export const myFollowsEndpoint = defineEndpoint({
  operationId: 'getMyFollows', method: 'GET', path: '/me/follows',
  summary: "The signed-in player's own follow sets — the app derives 'Following' / 'Follows you' from this.",
  auth: 'user', cacheControl: 'no-store',
  response: z.object({ followingIds: z.array(z.string()), followerIds: z.array(z.string()) }).strict(),
  handler: async ({ ctx }) => ({
    followingIds: await fetchFollowingIds(ctx.userId, ctx.userClient),
    followerIds: await fetchFollowerIds(ctx.userId, ctx.userClient),
  }),
})

async function targetId(client: Parameters<typeof findLiveProfileByUsername>[0], username: string) {
  const t = await findLiveProfileByUsername<{ id: string }>(client, username, 'id, username, deleted_at')
  if (!t) throw Errors.notFound()
  return t.id
}

export const followEndpoint = defineEndpoint({
  operationId: 'followPlayer', method: 'PUT', path: '/players/{username}/follow',
  summary: 'Follow a player. Idempotent; the new-follower notification fires only on a genuinely new follow.',
  auth: 'user', idempotent: true, cacheControl: 'no-store',
  response: z.object({ following: z.literal(true), created: z.boolean() }).strict(),
  handler: async ({ ctx, params }) => {
    const id = await targetId(ctx.userClient, params.username)
    const pending: Promise<unknown>[] = []
    const r = await followPlayer(ctx.userClient, ctx.userId, id, {
      notify: (uid, payload, key, opts) => { pending.push(Promise.resolve(notifyBoth(uid, payload, key, opts))) },
    })
    // Serverless may freeze un-awaited work once the response is sent; a failed notification must not fail the follow.
    await Promise.allSettled(pending)
    if (!r.ok) {
      if (r.code === 'self') throw new ApiError(400, 'cannot_follow_self', 'You cannot follow yourself.')
      if (r.code === 'blocked') throw new ApiError(403, 'follow_blocked', 'You cannot follow this player.')
      throw new ApiError(500, 'follow_failed', 'Could not follow this player.')
    }
    return { following: true as const, created: r.created }
  },
})

export const unfollowEndpoint = defineEndpoint({
  operationId: 'unfollowPlayer', method: 'DELETE', path: '/players/{username}/follow',
  summary: 'Unfollow a player. Naturally idempotent.', auth: 'user', cacheControl: 'no-store',
  response: z.object({ following: z.literal(false) }).strict(),
  handler: async ({ ctx, params }) => {
    const id = await targetId(ctx.userClient, params.username)
    const r = await unfollowPlayer(ctx.userClient, ctx.userId, id)
    if (!r.ok) throw new ApiError(500, 'unfollow_failed', 'Could not unfollow this player.')
    return { following: false as const }
  },
})
```

The `fetchFollowingIds/fetchFollowerIds` loaders take `(viewerId, client = createClient())` (add the param in this task if Task 5 didn't; unchanged default). Check `ApiError`'s constructor and `Errors.notFound` in `lib/mobile-api/errors.ts` (wager.ts uses `new ApiError(status, code, message)`). If the real `ApiError` restricts `code` to a union, add `cannot_follow_self`, `follow_blocked`, `follow_failed`, `unfollow_failed` there (append-only). `/me/follows` is a small hotspot table (`player_follows` reads on the caller's RLS client); unbounded on purpose, same as the feed.

Route `players/[username]/follow/route.ts`:

```ts
import { followEndpoint, unfollowEndpoint } from '@/lib/mobile-api/endpoints/follows'
export const PUT = followEndpoint.handler
export const DELETE = unfollowEndpoint.handler
```

- [ ] **Step 4: Register, then run tests + typecheck**

Append the three endpoints to `ALL_ENDPOINTS`. Run: `npx tsc --noEmit && npx vitest run lib/mobile-api lib/follows`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mobile-api lib/follows app/api/mobile/v1
git commit -m "feat(mobile-api): follow/unfollow and GET /me/follows"
```

---

### Task 9: `GET /me/progress`

**Files:**
- Create: `lib/players/progress-service.ts`, `lib/players/progress-service.test.ts`
- Create: `lib/mobile-api/endpoints/progress.ts`, `lib/mobile-api/endpoints/progress.test.ts`
- Create: `app/api/mobile/v1/me/progress/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`, `lib/players/service.ts` (only to share the season-standing helper — see Step 3)

**Interfaces:**
- Produces:

```ts
export interface MyProgress {
  xp: number; membershipTier: string
  tierProgress: { current: string; next: string | null; xpIntoTier: number; xpForNextTier: number | null } | null
  sxScore: number; sentinelTier: string | null
  coinBalance: number
  seasonStanding: { seasonName: string; rank: number | null; points: number; pointsAtRankSixteen: number; monthlyRank: number | null; monthlyPoints: number } | null
}
export async function getMyProgress(userClient: SupabaseClient, admin: AdminClient, userId: string, now = new Date()): Promise<MyProgress | null>
```

`tierProgress` is **`null` at max tier** per the spec — but then `next`/`xpForNextTier` would never be null inside it. Keep the object non-null and use `next: null, xpForNextTier: null` for max tier? The spec says `tierProgress: {...} | null (max tier)`. Follow the spec literally: `null` at max tier, and `next`/`xpForNextTier` are non-null strings/numbers inside. Set the type accordingly (`{ current: string; next: string; xpIntoTier: number; xpForNextTier: number }`).

- [ ] **Step 1: Write the failing service tests**

```ts
it('recruit with 250 XP → next guardian, xpIntoTier 250, xpForNextTier 1000')
it('guardian with 1500 XP → xpIntoTier 500, xpForNextTier 4000 (5000-1000)')
it('legend (>= 50,000) → tierProgress null')
it('membershipTier is computeTier(xp), not the stored column, when they disagree?') // No: mirror the web — XPProgressPanel shows computeTier(xp). Assert membershipTier === computeTier(xp).
it('no active season → seasonStanding null')
it('active season → rank/points/pointsAtRankSixteen/monthly numbers equal the profile page's owner card for the same fixture')
it('reads the coin balance with the admin client using only userId')
```

`xpIntoTier = xp - TIER_XP_THRESHOLDS[current]`, `xpForNextTier = TIER_XP_THRESHOLDS[next] - TIER_XP_THRESHOLDS[current]`. The season "parity" test compares `getMyProgress(...).seasonStanding` against `getPlayerProfile(..., OWNER_ID).ownerOnly.seasonStanding` for the same fixtures (both come from one shared function — Step 3).

- [ ] **Step 2: Run to verify failure** → `npx vitest run lib/players/progress-service.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

First factor the season-standing block out of `getPlayerProfile` into `lib/players/season-standing.ts`:

```ts
export async function loadSeasonStanding(supabase, admin, playerId: string, includeMonthly: boolean, now = new Date()): Promise<{ seasonId: string; seasonName: string; rank: number | null; points: number; pointsAtRankSixteen: number; monthlyRank: number | null; monthlyPoints: number } | null>
```

moving the exact code (active-season query, DLS game lookup, `getSeasonLeaderboard`, optional `getMonthlyLeaderboard`) and **the same call order**, plus `select('id, name')` for the season name (**first** confirm the `seasons` column holding the display name: `grep -n "seasons" supabase/migrations/*.sql`, or read `lib/seasons/data.ts` — use the real column; if the select changes from `'id'` to `'id, name'` the Task 2/3 query-log snapshots record `seasons:select|eq(status)|…` and stay identical because the log has no column list; confirm by running them). `getPlayerProfile` calls it with `includeMonthly = isOwner`; the public `seasonRank`/`ownerOnly.seasonStanding` are derived from the same object. Re-run the Task 2/3 characterization tests: **unchanged**.

Then `progress-service.ts`:

```ts
import { computeTier, TIER_XP_THRESHOLDS, type MembershipTier } from '@/lib/membership/tiers'
import { getCoinBalance } from '@/lib/coins/service'
import { loadSeasonStanding } from './season-standing'

const NEXT: Record<MembershipTier, MembershipTier | null> = { recruit: 'guardian', guardian: 'elite', elite: 'sentinel', sentinel: 'legend', legend: null }

export async function getMyProgress(userClient, admin, userId, now = new Date()) {
  const { data: p } = await userClient.from('profiles').select('xp, sx_score, sentinel_tier').eq('id', userId).maybeSingle()
  if (!p) return null
  const tier = computeTier(p.xp)
  const next = NEXT[tier]
  const [coinBalance, standing] = await Promise.all([getCoinBalance(admin, userId), loadSeasonStanding(userClient, admin, userId, true, now)])
  return {
    xp: p.xp, membershipTier: tier,
    tierProgress: next ? { current: tier, next, xpIntoTier: p.xp - TIER_XP_THRESHOLDS[tier], xpForNextTier: TIER_XP_THRESHOLDS[next] - TIER_XP_THRESHOLDS[tier] } : null,
    sxScore: p.sx_score, sentinelTier: p.sentinel_tier, coinBalance,
    seasonStanding: standing && { seasonName: standing.seasonName, rank: standing.rank, points: standing.points, pointsAtRankSixteen: standing.pointsAtRankSixteen, monthlyRank: standing.monthlyRank, monthlyPoints: standing.monthlyPoints },
  }
}
```

(`Promise.all` here is fine — this is a new endpoint, not part of the behavior-neutral extraction.) Endpoint: `auth: 'user'`, `cacheControl: 'no-store'`, strict schema, 404 (`Errors.notFound()`) if `getMyProgress` returns null, passes `ctx.userClient, ctx.admin, ctx.userId`.

- [ ] **Step 4: Endpoint tests** — exact top-level key set `['coinBalance','membershipTier','seasonStanding','sentinelTier','sxScore','tierProgress','xp']`; `seasonStanding` key set; `Cache-Control: no-store`; 401 without auth (mock `authenticate` to throw the real unauthorized `ApiError`); admin client receives only `ctx.userId`.

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS; Task 2/3 snapshots untouched.

- [ ] **Step 6: Commit**

```bash
git add lib app/api/mobile/v1/me/progress
git commit -m "feat(mobile-api): GET /me/progress (XP tier, SX score, coins, season standing)"
```

---

### Task 10: History endpoints — XP events, SX Score events, coin transactions

**Files:**
- Create: `lib/mobile-api/history-cursor.ts`, `lib/mobile-api/history-cursor.test.ts`
- Create: `lib/mobile-api/endpoints/histories.ts`, `lib/mobile-api/endpoints/histories.test.ts`
- Create: `app/api/mobile/v1/me/{xp-events,sx-score-events,coin-transactions}/route.ts`
- Modify: `lib/mobile-api/endpoints/index.ts`
- Maybe create: `supabase/migrations/<UTC timestamp>_history_cursor_indexes.sql` (Step 1 decides)

**Interfaces:**
- Produces:

```ts
// history-cursor.ts
export const HISTORY_PAGE_SIZE = 20
export function encodeCursor(row: { created_at: string; id: string }): string           // base64url of JSON {t, id}
export function decodeCursor(raw: string): { t: string; id: string }                     // throws ApiError 400 invalid_cursor
export function keysetFilter(c: { t: string; id: string }): string                       // PostgREST .or() string
export function pageOf<T extends { created_at: string; id: string }>(rows: T[]): { items: T[]; nextCursor: string | null } // rows fetched with limit 21
```

- [ ] **Step 1: Confirm the schema and decide on an index** (Supabase MCP `execute_sql` against `ofxmoxpvwbemfouaowoa`, read-only)

```sql
select table_name, column_name, data_type from information_schema.columns
 where table_schema='public' and table_name in ('xp_events','sx_score_events','sx_coin_transactions')
   and column_name in ('id','player_id','created_at','note','reference_id','match_id') order by 1,2;
select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
 where conrelid in ('public.xp_events'::regclass,'public.sx_score_events'::regclass,'public.sx_coin_transactions'::regclass) and contype='c';
select tablename, indexdef from pg_indexes where schemaname='public' and tablename in ('xp_events','sx_score_events','sx_coin_transactions');
select relname, n_live_tup from pg_stat_user_tables where relname in ('xp_events','sx_score_events','sx_coin_transactions');
```

Record: (a) all three tables have a uuid `id` (if any lacks one, stop and ask — the keyset needs a tiebreaker); (b) the live source/event_type value lists (paste them into the PR description — the Flutter plan seeds its label maps from them); (c) whether `(player_id, created_at desc, id desc)` is covered. Rule: if a table has > ~50k rows and no `player_id`-leading index, add a migration `CREATE INDEX IF NOT EXISTS … ON public.<t> (player_id, created_at DESC, id DESC);`, apply to staging via the migration tool, and re-run the `pg_indexes` query; otherwise write "no index needed at n rows" in the PR. (`xp_events` has `(player_id)` only — fine at low volume.)

- [ ] **Step 2: Write the failing cursor tests**

```ts
describe('cursor', () => {
  it('round-trips and preserves the raw timestamp string (microseconds!)', () => {
    const row = { created_at: '2026-09-24T10:00:00.123456+00:00', id: '11111111-1111-1111-1111-111111111111' }
    expect(decodeCursor(encodeCursor(row))).toEqual({ t: row.created_at, id: row.id })
  })
  it('rejects garbage, wrong shape, non-uuid id, and a timestamp that is not ISO', () => {
    for (const bad of ['%%%', Buffer.from('{"t":1}').toString('base64url'), Buffer.from('{"t":"x","id":"y"}').toString('base64url'),
      Buffer.from('{"t":"2026-01-01T00:00:00Z),id.eq.1","id":"11111111-1111-1111-1111-111111111111"}').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrowError(expect.objectContaining({ status: 400 }))
    }
  })
  it('keysetFilter quotes the timestamp', () => {
    expect(keysetFilter({ t: '2026-09-24T10:00:00.123456+00:00', id: 'i' }))
      .toBe('created_at.lt."2026-09-24T10:00:00.123456+00:00",and(created_at.eq."2026-09-24T10:00:00.123456+00:00",id.lt.i)')
  })
  it('pageOf: 21 rows → 20 items + cursor of the 20th; <=20 rows → no cursor', () => { /* … */ })
})
```

The cursor **must** carry the exact `created_at` string PostgREST returned — a JS `Date` round-trip truncates microseconds and would skip/duplicate rows sharing a millisecond. The ISO-shape and uuid regexes in `decodeCursor` are also the **filter-injection guard**, because the decoded values are interpolated into `.or()`.

- [ ] **Step 3: Run to verify failure** → FAIL.

- [ ] **Step 4: Implement `history-cursor.ts`**

```ts
import { ApiError } from './errors'
export const HISTORY_PAGE_SIZE = 20
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bad = () => new ApiError(400, 'invalid_cursor', 'Invalid cursor.')

export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.created_at, id: row.id })).toString('base64url')
}
export function decodeCursor(raw: string): { t: string; id: string } {
  let v: unknown
  try { v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) } catch { throw bad() }
  const o = v as { t?: unknown; id?: unknown }
  if (!o || typeof o.t !== 'string' || typeof o.id !== 'string' || !ISO.test(o.t) || !UUID.test(o.id)) throw bad()
  return { t: o.t, id: o.id }
}
export function keysetFilter(c: { t: string; id: string }): string {
  return `created_at.lt."${c.t}",and(created_at.eq."${c.t}",id.lt.${c.id})`
}
export function pageOf<T extends { created_at: string; id: string }>(rows: T[]) {
  const items = rows.slice(0, HISTORY_PAGE_SIZE)
  return { items, nextCursor: rows.length > HISTORY_PAGE_SIZE ? encodeCursor(items[items.length - 1]) : null }
}
```

- [ ] **Step 5: Write the failing endpoint tests** (`histories.test.ts`)

For each of the three endpoints, with a hand-rolled fake `userClient` recording the chain (`from/select/eq/order/or/limit`):

```ts
it('selects an explicit column list that excludes note / reference_id')   // assert the select() string
it('filters .eq("player_id", ctx.userId)')
it('orders created_at desc then id desc and limits to 21')
it('applies the keyset .or() when a cursor is given, none when absent')
it('returns items + nextCursor; nextCursor is null on the last page')
it('a fixture row that carries "note" / "reference_id" is stripped from the response')   // feed the fake a row WITH note; assert absent in body
it('exact item key set — XP: [createdAt, id, source, xp]; SX: [createdAt, eventType, id, matchId, pointsDelta]; coins: [amount, balanceAfter, createdAt, description, id, source]')
it('invalid cursor → 400 invalid_cursor')
it('no-store; never touches ctx.admin')
it('ties: 3 rows sharing one created_at across a page boundary → paging with the returned cursors yields each row exactly once, in id-desc order') // drive a tiny in-memory implementation of the .or() semantics in the fake, or assert on the emitted filter string plus a pure-JS reference filter
```

The tie test is required by spec §10. Implement it with an in-test reference filter that evaluates `keysetFilter`'s semantics `(created_at < t) OR (created_at = t AND id < id0)` over 45 rows with identical timestamps and asserts two full page walks return all 45 ids once.

- [ ] **Step 6: Implement `histories.ts`**

```ts
import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { decodeCursor, keysetFilter, pageOf, HISTORY_PAGE_SIZE } from '../history-cursor'

const q = z.string().min(1).max(512)

async function page<T extends { created_at: string; id: string }>(
  ctx: { userClient: any; userId: string }, table: string, cols: string, req: Request,
): Promise<{ items: T[]; nextCursor: string | null }> {
  const raw = new URL(req.url).searchParams.get('cursor')
  let query = ctx.userClient.from(table).select(cols).eq('player_id', ctx.userId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_PAGE_SIZE + 1)
  if (raw) query = query.or(keysetFilter(decodeCursor(q.parse(raw))))
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return pageOf((data ?? []) as T[])
}

const xpItem = z.object({ id: z.string(), xp: z.number(), source: z.string(), createdAt: z.string() }).strict()
export const xpEventsEndpoint = defineEndpoint({
  operationId: 'getMyXpEvents', method: 'GET', path: '/me/xp-events',
  summary: "The signed-in player's XP ledger, newest first, 20 per page. Cursor-paged.",
  auth: 'user', cacheControl: 'no-store',
  response: z.object({ items: z.array(xpItem), nextCursor: z.string().nullable() }).strict(),
  handler: async ({ ctx, req }) => {
    const p = await page<{ id: string; xp: number; source: string; created_at: string }>(ctx, 'xp_events', 'id, xp, source, created_at', req)
    return { items: p.items.map((r) => ({ id: r.id, xp: r.xp, source: r.source, createdAt: r.created_at })), nextCursor: p.nextCursor }
  },
})
// sxScoreEventsEndpoint: table 'sx_score_events', cols 'id, match_id, event_type, points_delta, created_at' — NO note.
//   item: { id, eventType, pointsDelta, matchId: string|null, createdAt }
// coinTransactionsEndpoint: table 'sx_coin_transactions', cols 'id, amount, balance_after, source, description, created_at' — NO reference_id.
//   item: { id, amount, balanceAfter, source, description: string|null, createdAt }
```

Write the other two in full following the same shape (paths `/me/sx-score-events`, `/me/coin-transactions`; operationIds `getMySxScoreEvents`, `getMyCoinTransactions`). Replace the `any` on `userClient` with the real `SupabaseClient` type (lint rejects `any` if `no-explicit-any` is on; if the table names aren't in the generated `Database` type union, use a narrow cast on `from(table as never)`). Raw codes are returned; the app localizes them.

- [ ] **Step 7: Routes, registry, then run everything**

Three one-line route files; append three endpoints to `ALL_ENDPOINTS`. Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib app/api/mobile/v1/me supabase
git commit -m "feat(mobile-api): cursor-paged XP, SX Score and coin history endpoints"
```

---

### Task 11: Contract, gates, and staging verification

**Files:**
- Modify: `openapi/mobile-v1.json` (generated)

- [ ] **Step 1: Rebase onto current `main`** and resolve `index.ts` conflicts append-only.

```bash
git fetch origin && git rebase origin/main
```

- [ ] **Step 2: Regenerate and commit the contract (last)**

Run: `npm run openapi`
Expected: `openapi/mobile-v1.json` gains 11 operations (`searchPlayers`, `getPlayerProfile`, `getPlayerFollowers`, `getPlayerFollowing`, `getMyFollows`, `followPlayer`, `unfollowPlayer`, `getMyProgress`, `getMyXpEvents`, `getMySxScoreEvents`, `getMyCoinTransactions`). `git diff --stat openapi/` shows only additions. Never hand-merge this file.

- [ ] **Step 3: Full gates**

Run: `npx tsc --noEmit && npm run test && npm run lint && npm run build`
Expected: all clean. Check `git worktree list` first so vitest doesn't double-count.

- [ ] **Step 4: Push and verify on the Vercel preview against staging**

```bash
git add openapi lib app
git commit -m "chore(openapi): publish Phase 3b operations"
git push -u origin phase3b/web-endpoints
```

With the preview URL `$P` and a staging bearer token `$T` (QA account; see memory `reference_qa_account_password_via_sql` if you need a password), run and record in the PR description:

```bash
# 1. No private data or locked achievements in any public body
for u in $(curl -s "$P/api/mobile/v1/players?q=" | jq -r '.data[0:10][].username'); do
  curl -s "$P/api/mobile/v1/players/$u" > /tmp/p.json
  grep -Eiq 'whatsapp|phone|notification_prefs|referred|deletion' /tmp/p.json && echo "LEAK private: $u"
  jq -r '.data.achievements | "\(.unlockedCount)/\(.total)"' /tmp/p.json
done
# 2. Locked-name check against the live catalogue: fetch all achievement names via the Supabase MCP execute_sql
#    (select name, slug from achievements) and, for each player body, assert no locked one appears.
# 3. Public bodies identical with and without a token
diff <(curl -s "$P/api/mobile/v1/players/$U") <(curl -s -H "Authorization: Bearer $T" "$P/api/mobile/v1/players/$U") && echo IDENTICAL
# 4. Follow round trip (two Idempotency-Keys, then a replay)
curl -s -X PUT -H "Authorization: Bearer $T" -H "Idempotency-Key: $(uuidgen)" "$P/api/mobile/v1/players/$U/follow"     # created:true
curl -s -X PUT -H "Authorization: Bearer $T" -H "Idempotency-Key: $(uuidgen)" "$P/api/mobile/v1/players/$U/follow"     # created:false
curl -s -H "Authorization: Bearer $T" "$P/api/mobile/v1/me/follows" | jq
# 5. Histories vs DB rows
curl -s -H "Authorization: Bearer $T" "$P/api/mobile/v1/me/xp-events" | jq '.data.items | length, .data.nextCursor'
```

Then with the Supabase MCP `execute_sql` on staging: confirm the `player_follows` row exists (and shows on the web profile), the target got **exactly one** `player_notifications` row of type `new_follower` (the second PUT and any replay added none), and that for the QA account each history endpoint's item count/order equals `select … from <table> where player_id = … order by created_at desc, id desc` (walk `nextCursor` to the end and compare id lists). Finish with `DELETE` and confirm the row is gone.

Also compare 10 profiles side by side (API vs the web page): stats, rank, streak, category stats, titles, last-10 matches, unlocked achievements in the web's rarity order, follower/following counts, posts/gallery — the spec's exit criterion. Record the result.

- [ ] **Step 5: Finish**

PR 2 description: the endpoint list, the Task 10 live CHECK value lists (for the Flutter label maps), the index decision, and the staging evidence above. Merge to `main` per the repo's always-push workflow once Vercel is green; then write the Flutter plan for `sentinelx_mobile` from spec §7.

---

## Self-Review (run against the spec)

**Spec coverage**

| Spec | Task |
|---|---|
| §3 PR 1 characterization (anon, signed-in follows/not, followed-by, owner, 404 unknown, 404 deleted, locked+unlocked, directory ±q, followers, following) | Tasks 2, 3 |
| §3 PR 1 cost baseline | Tasks 0, 2, 5 |
| §3 PR 1 `getPlayerProfile`, `searchPlayers`, follow service (`{ok, created}` / codes), thin actions with today's strings, list loaders | Tasks 4, 5 |
| §3 PR 2 endpoint table (11 endpoints, caches, idempotency) | Tasks 7–10 |
| public endpoints don't read bearer + byte-identical | Task 7 tests |
| follow on `userClient`, error map, notify-only-when-created, replay fires nothing | Tasks 4, 8 |
| history on `userClient` + `player_id` filter | Task 10 |
| `/me/progress` service-role paths limited to coin balance + season standing | Task 9 |
| §4 profile shape, strict schemas, key-set tests, locked-achievement catalogue test first | Task 6 |
| `xp` public-or-not (§4, §11) | Resolved: public (Facts) |
| §5 progress shape, tier math reuse, DLS-only season | Task 9 |
| §6 histories: 20/page, newest first, keyset on `(created_at, id)`, invalid cursor 400, `note`/`reference_id` absent, raw codes | Task 10 |
| §10 tie/equal-timestamp pagination test | Task 10 Step 5 |
| §11 live CHECK constraints, index need, followers ordering/limits | Task 10 Step 1, Facts |
| §9 verification 1–5 | Tasks 5, 11 |
| §7 Flutter | Out of this plan (separate plan after PR 2) |

**Placeholder scan:** Task 8 Step 1 and Task 9 Step 1 list test cases as one-liners; the implementer must expand each into a full `it()` with the assertions named in the line (the fake/context helper pattern is shown in the Task 8 header block and mirrors `wager.test.ts`). No other TBDs.

**Known deviations / flags for the reviewer**
1. `GET /players` cannot exclude the viewer (public, byte-identical); the app filters its own username.
2. Follower/following endpoints return a bare ≤100 array (web parity, no cursor).
3. `getPlayerProfile` always needs the admin client because the public `seasonRank` read uses it on the web today; the public endpoint passes `viewerId = null` so no owner-only data is read.
4. `tierProgress` is `null` at max tier and non-null-typed inside, per the spec's literal wording.
5. The notification is awaited inside the mobile follow handler (settled, never failing the follow), while the web action keeps its fire-and-forget behavior.
