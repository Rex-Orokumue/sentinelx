# Community Follows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Piece 3 of the community rebuild — an asymmetric follow graph (`player_follows`), follower/following counts and lists on player profiles, a Follow/Unfollow button, and a "Following" tab on the community feed.

**Architecture:** One new table (`player_follows`) with public-read RLS and owner-only insert/delete, mirroring the shape of `dm_blocks`/`023_friends_and_friendly_matches`. A pure-logic module (`lib/follows/predicates.ts`) carries the self-follow rejection and follow predicate, unit-tested; a query layer (`lib/follows/query.ts`) does the actual Supabase reads (counts via `count: 'exact', head: true`, never a stored counter); two server actions (`followPlayer`, `unfollowPlayer`) do the writes. The feed's "Following" tab reuses the existing client-side `FeedFilters`/`FeedList` pattern (already filters `all`/`results`/`announcements`/`achievements` over the already-loaded page, no refetch) rather than inventing a new server round-trip — consistent with how the other three tabs already work. Blocking (`dm_blocks`, shipped with direct messages) severs an existing follow in both directions and blocks re-following, enforced once at the RLS layer plus a delete alongside `blockUser`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth + Realtime), Tailwind, `zod`-free (no user input to validate — a follow has no body), `vitest`.

**Spec:**
- `docs/superpowers/specs/2026-09-07-follows-design.md` (this piece)
- `docs/superpowers/specs/2026-09-07-community-system-overview.md` (cross-cutting rules)

## Global Constraints

- **Mobile-first.** Design at 375px, scale up.
- **RLS on every table.** `player_follows` is public-read (follower counts are shown on profiles, as on any social product); insert/delete are owner-only (`follower_id = auth.uid()`); no UPDATE policy — a follow either exists or does not.
- **Counts are derived, not stored.** No `follower_count`/`following_count` column on `profiles`. Count via `SELECT count(*) ... head: true`, never a denormalised counter — this codebase already had one score-drift incident (Phase 2 SX Score, ~10 days) from exactly that pattern.
- **Follows is a separate graph from friends.** `023_friends_and_friendly_matches` is symmetric and consent-based (for arranging a friendly match); do not reuse or touch it.
- **Blocking interaction (spec §"Blocking interaction").** Since direct messages shipped first, blocking someone (`dm_blocks`) must sever any existing follow in both directions and prevent a new one, enforced in one place.
- **Migrations are timestamp-named.** `YYYYMMDDHHMMSS_name.sql` (UTC). Latest existing migration is `20260913120000_dm_stickers_audio_forward.sql`; use a later timestamp.
- **Supabase project id for type generation:** `itxubrkbropttfdackmi`.
- **Out of scope (spec §"Scope for v1"):** "who to follow" suggestions, mutual-follow indicators, notifications on being followed, private accounts with approval.
- **Cuttable corner (spec):** the follower/following list pages are the first thing to cut under time pressure — Task 6 builds them, but keep them deliberately minimal (no inline follow/unfollow controls on the list itself; click through to the profile).

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/<timestamp>_player_follows.sql` | `player_follows` table + RLS (public read, owner insert/delete, block-aware insert check) |
| `lib/follows/predicates.ts` | Pure logic: `canFollow`, `isFollowing`, `safeCount` |
| `lib/follows/predicates.test.ts` | Unit tests for the above |
| `lib/follows/query.ts` | Server-only reads: `fetchFollowCounts`, `fetchIsFollowing`, `fetchFollowingIds`, `fetchFollowers`, `fetchFollowing` |
| `lib/follows/actions.ts` | `'use server'` — `followPlayer`, `unfollowPlayer` |
| `components/player/FollowButton.tsx` | `'use client'` — follow/unfollow toggle, used inside `ProfilePlayerActions` |
| `app/[locale]/(public)/players/[username]/followers/page.tsx` | Followers list page |
| `app/[locale]/(public)/players/[username]/following/page.tsx` | Following list page |

**Modified files:**

| Path | Change |
|---|---|
| `lib/supabase/types.ts` | Regenerated after the migration is applied |
| `lib/messages/actions.ts` | `blockUser` also deletes any `player_follows` row between the two players (both directions) |
| `lib/players/profile.ts` | `ProfileView` gains `followerCount: number`, `followingCount: number` |
| `app/[locale]/(public)/players/[username]/page.tsx` | Fetch follow counts + viewer's follow state, pass into `ProfileHeader`/`ProfilePlayerActions` |
| `components/player/ProfileHeader.tsx` | Follower/following counts as links, next to the season-rank line |
| `components/player/ProfilePlayerActions.tsx` | Render `<FollowButton>` (hidden when `blocked`, same rule as the Message button) |
| `components/community/FeedFilters.tsx` | Add a `following` tab, shown only when `showFollowing` is true |
| `components/community/FeedList.tsx` | Accept `followingIds: string[]`, filter on it, distinct empty state for the `following` tab |
| `app/[locale]/(public)/community/page.tsx` | Fetch `followingIds` for the viewer, pass to `FeedList` |

---

## Task 1: Schema — `player_follows` table, apply, regenerate types

**Files:**
- Create: `supabase/migrations/<timestamp>_player_follows.sql`
- Modify: `lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: `public.player_follows` table live in production; `Database['public']['Tables']['player_follows']` in `lib/supabase/types.ts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260913150000_player_follows.sql` (use the real current UTC timestamp if later migrations have landed):

```sql
-- Follows — Piece 3 of 4 of the community rebuild (see
-- docs/superpowers/specs/2026-09-07-follows-design.md). An asymmetric graph:
-- follower_id follows following_id, no approval needed. Deliberately separate
-- from friends (023_friends_and_friendly_matches), which is symmetric and
-- consent-based for arranging a friendly match — overloading it here would
-- break that flow.
--
-- No follower_count/following_count column anywhere: a denormalised counter
-- drifts the moment anything writes outside the one path that maintains it
-- (see the Phase 2 SX Score drift incident, ~10 days of wrong player stats).
-- Counting rows is fast at this scale — see lib/follows/query.ts.

CREATE TABLE public.player_follows (
  follower_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT player_follows_not_self CHECK (follower_id <> following_id)
);

-- (follower_id, following_id) is already indexed by the PK; following_id
-- alone needs its own index for "who follows me" / follower counts.
CREATE INDEX player_follows_following_idx ON public.player_follows (following_id);

ALTER TABLE public.player_follows ENABLE ROW LEVEL SECURITY;

-- The graph is public — follower/following counts show on any profile, as on
-- any social product.
CREATE POLICY "player_follows_public_read" ON public.player_follows
  FOR SELECT USING (true);

-- You may only create a follow as yourself, and not against someone who has
-- blocked you or whom you have blocked (dm_blocks, either direction) — the
-- same rule dm_can_message enforces for messaging. Direct messages shipped
-- first, so this is added now rather than left as a follow-up.
CREATE POLICY "player_follows_own_insert" ON public.player_follows
  FOR INSERT WITH CHECK (
    follower_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.dm_blocks b
      WHERE (b.blocker_id = follower_id AND b.blocked_id = following_id)
         OR (b.blocker_id = following_id AND b.blocked_id = follower_id)
    )
  );

-- No UPDATE policy — a follow either exists or does not.
CREATE POLICY "player_follows_own_delete" ON public.player_follows
  FOR DELETE USING (follower_id = auth.uid());
```

- [ ] **Step 2: Apply the migration to production**

- **Preferred (MCP):** Supabase `apply_migration` tool, name `20260913150000_player_follows`.
- **Or CLI from `C:/Users/gorok/Videos/sentinelx`:** `npx supabase db push` (intermittently unreachable on this machine — see memory `project_supabase_connectivity_gotcha`; prefer MCP).

If neither is available, **stop and ask the user to apply it** — every later task depends on the table existing.

- [ ] **Step 3: Verify in production**

Run via MCP `execute_sql` (or `npx supabase db execute`):

```sql
SELECT to_regclass('public.player_follows') AS player_follows;
SELECT polname FROM pg_policy
WHERE polrelid = 'public.player_follows'::regclass
ORDER BY polname;
```

Expected: `player_follows` non-null; policies are exactly `player_follows_own_delete`, `player_follows_own_insert`, `player_follows_public_read`.

- [ ] **Step 4: Regenerate types**

```bash
npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts
```

```bash
grep -c "player_follows:" lib/supabase/types.ts   # expect 1
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts
git commit -m "feat(community): player_follows schema

Piece 3 of the community rebuild. Asymmetric follow graph, public-read,
owner-only insert/delete. INSERT policy blocks a follow in either direction
between two players who have blocked each other in dm_blocks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 2: Pure logic — follow predicate, self-follow rejection, count coercion (TDD)

**Files:**
- Create: `lib/follows/predicates.ts`
- Test: `lib/follows/predicates.test.ts`

**Interfaces:**
- Produces:
  - `canFollow(followerId: string, followingId: string): { ok: true } | { ok: false; error: string }`
  - `type FollowRow = { followerId: string; followingId: string }`
  - `isFollowing(rows: FollowRow[], followerId: string, followingId: string): boolean`
  - `safeCount(count: number | null): number`
- Consumed by: `lib/follows/actions.ts` (Task 4), `lib/follows/query.ts` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `lib/follows/predicates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canFollow, isFollowing, safeCount } from './predicates'

describe('canFollow', () => {
  it('allows following someone else', () => {
    expect(canFollow('a', 'b')).toEqual({ ok: true })
  })
  it('rejects following yourself', () => {
    expect(canFollow('a', 'a')).toEqual({ ok: false, error: 'You cannot follow yourself.' })
  })
})

describe('isFollowing', () => {
  const rows = [
    { followerId: 'a', followingId: 'b' },
    { followerId: 'c', followingId: 'b' },
  ]
  it('is true for an existing pair', () => {
    expect(isFollowing(rows, 'a', 'b')).toBe(true)
  })
  it('is false for a reversed pair (asymmetric)', () => {
    expect(isFollowing(rows, 'b', 'a')).toBe(false)
  })
  it('is false for an unrelated pair', () => {
    expect(isFollowing(rows, 'a', 'c')).toBe(false)
  })
  it('is false for an empty graph', () => {
    expect(isFollowing([], 'a', 'b')).toBe(false)
  })
})

describe('safeCount', () => {
  it('passes through a real count', () => {
    expect(safeCount(42)).toBe(42)
  })
  it('coerces null to zero', () => {
    expect(safeCount(null)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/follows/predicates.test.ts`
Expected: FAIL — `./predicates` has no exports yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `lib/follows/predicates.ts`:

```ts
export function canFollow(followerId: string, followingId: string): { ok: true } | { ok: false; error: string } {
  if (followerId === followingId) return { ok: false, error: 'You cannot follow yourself.' }
  return { ok: true }
}

export interface FollowRow {
  followerId: string
  followingId: string
}

export function isFollowing(rows: FollowRow[], followerId: string, followingId: string): boolean {
  return rows.some((r) => r.followerId === followerId && r.followingId === followingId)
}

// Supabase types a head-count query's result as `number | null` — this is the
// one place that coercion happens, so every caller gets a definite number.
export function safeCount(count: number | null): number {
  return count ?? 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/follows/predicates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/follows/predicates.ts lib/follows/predicates.test.ts
git commit -m "feat(follows): pure predicates — canFollow, isFollowing, safeCount

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 3: Query layer

**Files:**
- Create: `lib/follows/query.ts`

**Interfaces:**
- Consumes: `safeCount` from `lib/follows/predicates.ts` (Task 2).
- Produces:
  - `fetchFollowCounts(profileId: string): Promise<{ followers: number; following: number }>`
  - `fetchIsFollowing(viewerId: string, profileId: string): Promise<boolean>`
  - `fetchFollowingIds(viewerId: string): Promise<string[]>`
  - `interface FollowListEntry { id: string; username: string | null; displayName: string | null; avatarUrl: string | null; membershipTier: string }`
  - `fetchFollowers(profileId: string, limit?: number): Promise<FollowListEntry[]>`
  - `fetchFollowing(profileId: string, limit?: number): Promise<FollowListEntry[]>`
- Consumed by: `app/[locale]/(public)/players/[username]/page.tsx` (Task 5), the followers/following pages (Task 6), `app/[locale]/(public)/community/page.tsx` (Task 7).

No TDD here — this is a thin Supabase read layer (same convention as `lib/community/status-query.ts`: only pure logic gets unit tests, data-access is verified end-to-end).

- [ ] **Step 1: Write the query module**

Create `lib/follows/query.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { safeCount } from './predicates'

export async function fetchFollowCounts(profileId: string): Promise<{ followers: number; following: number }> {
  const supabase = createClient()
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from('player_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', profileId),
    supabase.from('player_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', profileId),
  ])
  return { followers: safeCount(followers), following: safeCount(following) }
}

export async function fetchIsFollowing(viewerId: string, profileId: string): Promise<boolean> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_follows')
    .select('follower_id')
    .eq('follower_id', viewerId)
    .eq('following_id', profileId)
    .maybeSingle()
  return !!data
}

// Every profile the viewer follows — used to drive the feed's "Following"
// tab. Unbounded: a player following thousands of others is not a case this
// platform has, and the feed filter only needs id membership.
export async function fetchFollowingIds(viewerId: string): Promise<string[]> {
  const supabase = createClient()
  const { data } = await supabase.from('player_follows').select('following_id').eq('follower_id', viewerId)
  return (data ?? []).map((r) => r.following_id)
}

export interface FollowListEntry {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  membershipTier: string
}

type ProfileRow = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  membership_tier: string
}
type ProfileRef = ProfileRow | ProfileRow[] | null
function firstProfile(p: ProfileRef): ProfileRow | null {
  return Array.isArray(p) ? (p[0] ?? null) : p
}
function toEntry(p: ProfileRow | null): FollowListEntry | null {
  if (!p) return null
  return { id: p.id, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url, membershipTier: p.membership_tier }
}

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, membership_tier'

// Who follows profileId. Capped at `limit` (default 100) — the follower/
// following list pages are the spec's named "cuttable corner"; a single
// uncapped page is enough for v1 rather than building full pagination.
export async function fetchFollowers(profileId: string, limit = 100): Promise<FollowListEntry[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_follows')
    .select(`follower:profiles!player_follows_follower_id_fkey(${PROFILE_FIELDS})`)
    .eq('following_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown as { follower: ProfileRef }[])
    .map((r) => toEntry(firstProfile(r.follower)))
    .filter((e): e is FollowListEntry => e !== null)
}

// Who profileId follows.
export async function fetchFollowing(profileId: string, limit = 100): Promise<FollowListEntry[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('player_follows')
    .select(`following:profiles!player_follows_following_id_fkey(${PROFILE_FIELDS})`)
    .eq('follower_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown as { following: ProfileRef }[])
    .map((r) => toEntry(firstProfile(r.following)))
    .filter((e): e is FollowListEntry => e !== null)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes. If the embedded-select types don't resolve (the profile page has a precedent comment for this — "the Supabase type-level select parser can't resolve these multi-embed joins"), the `as unknown as` casts above already route around it; confirm no additional cast is needed elsewhere.

- [ ] **Step 3: Commit**

```bash
git add lib/follows/query.ts
git commit -m "feat(follows): query layer — counts, isFollowing, followingIds, lists

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 4: Server actions — follow, unfollow, sever-on-block

**Files:**
- Create: `lib/follows/actions.ts`
- Modify: `lib/messages/actions.ts:215-225` (`blockUser`)

**Interfaces:**
- Consumes: `canFollow` from `lib/follows/predicates.ts` (Task 2).
- Produces:
  - `followPlayer(profileId: string): Promise<{ error?: string }>`
  - `unfollowPlayer(profileId: string): Promise<{ error?: string }>`
- Consumed by: `components/player/FollowButton.tsx` (Task 5).

- [ ] **Step 1: Write the server actions**

Create `lib/follows/actions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canFollow } from './predicates'

async function authed() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

export async function followPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const check = canFollow(userId, profileId)
  if (!check.ok) return { error: check.error }

  const { error } = await supabase
    .from('player_follows')
    .upsert({ follower_id: userId, following_id: profileId }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
  // 42501 = RLS WITH CHECK failed — the only way that happens here is the
  // dm_blocks check in player_follows_own_insert (Task 1).
  if (error) return { error: error.code === '42501' ? 'You cannot follow this player.' : 'Could not follow this player.' }

  revalidatePath('/community')
  return {}
}

export async function unfollowPlayer(profileId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  const { error } = await supabase.from('player_follows').delete().eq('follower_id', userId).eq('following_id', profileId)
  if (error) return { error: 'Could not unfollow this player.' }
  revalidatePath('/community')
  return {}
}
```

- [ ] **Step 2: Sever an existing follow when blocking (either direction)**

Read `lib/messages/actions.ts:215-225` first (current `blockUser`). Modify it:

```ts
export async function blockUser(otherId: string): Promise<{ error?: string }> {
  const { supabase, userId } = await authed()
  if (!userId) return { error: 'Please log in.' }
  if (otherId === userId) return { error: 'You cannot block yourself.' }
  const { error } = await supabase
    .from('dm_blocks')
    .upsert({ blocker_id: userId, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
  if (error) return { error: 'Could not block this player.' }

  // A block severs any existing follow in either direction (follows spec
  // §"Blocking interaction"). The request-scoped client's RLS delete policy
  // only lets userId delete rows where THEY are follower_id, so the reverse
  // direction (otherId was following userId) needs the admin client.
  const admin = createAdminClient()
  await admin
    .from('player_follows')
    .delete()
    .or(`and(follower_id.eq.${userId},following_id.eq.${otherId}),and(follower_id.eq.${otherId},following_id.eq.${userId})`)

  revalidatePath('/messages')
  return {}
}
```

Add the import at the top of the file if not already present: `import { createAdminClient } from '@/lib/supabase/admin'` — check first; `resolveOrCreateThread` in the same file already uses `createAdminClient`, so this import should already exist.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add lib/follows/actions.ts lib/messages/actions.ts
git commit -m "feat(follows): followPlayer/unfollowPlayer + sever follow on block

blockUser now also deletes any player_follows row between the two players in
either direction, alongside the RLS insert check (Task 1) that stops a new
follow forming between blocked players.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 5: Profile — Follow button, counts, and links

**Files:**
- Modify: `lib/players/profile.ts` (`ProfileView`)
- Modify: `app/[locale]/(public)/players/[username]/page.tsx`
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `components/player/ProfilePlayerActions.tsx`
- Create: `components/player/FollowButton.tsx`

**Interfaces:**
- Consumes: `fetchFollowCounts`, `fetchIsFollowing` (Task 3); `followPlayer`, `unfollowPlayer` (Task 4).
- Produces: `ProfileView.followerCount: number`, `ProfileView.followingCount: number`.

- [ ] **Step 1: Extend `ProfileView`**

In `lib/players/profile.ts`, add to the `ProfileView` interface (after `totalRankedPlayers`):

```ts
  /** Distinct players who follow this profile. */
  followerCount: number
  /** Distinct players this profile follows. */
  followingCount: number
```

- [ ] **Step 2: Write `FollowButton`**

Create `components/player/FollowButton.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, UserCheck } from 'lucide-react'
import { followPlayer, unfollowPlayer } from '@/lib/follows/actions'

export function FollowButton({ profileId, initialFollowing }: { profileId: string; initialFollowing: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [following, setFollowing] = useState(initialFollowing)
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    start(async () => {
      setError(null)
      const res = following ? await unfollowPlayer(profileId) : await followPlayer(profileId)
      if (res.error) {
        setError(res.error)
        return
      }
      setFollowing((f) => !f)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-center gap-1 sm:items-start">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={
          following
            ? 'inline-flex items-center gap-1.5 rounded-lg border border-sx-border px-3 py-1.5 text-xs font-bold text-white hover:border-red-500/50 hover:text-red-400 disabled:opacity-50'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-sx-purple/40 bg-sx-purple/20 px-3 py-1.5 text-xs font-bold text-sx-purple-text hover:bg-sx-purple/30 disabled:opacity-50'
        }
      >
        {following ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
        {pending ? '…' : following ? 'Following' : 'Follow'}
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Wire into `ProfilePlayerActions`**

In `components/player/ProfilePlayerActions.tsx`, add a `isFollowing: boolean` prop and render `<FollowButton>` hidden under the same `!blocked` condition as the Message button:

```tsx
import { FollowButton } from '@/components/player/FollowButton'
```

```tsx
export function ProfilePlayerActions({
  profileId,
  friendshipStatus,
  blockedByMe,
  isFollowing,
}: {
  profileId: string
  friendshipStatus: FriendshipStatus
  blockedByMe: boolean
  isFollowing: boolean
}) {
```

Inside the `<div className="flex flex-wrap ...">`, right after `<FriendStatusInline .../>`:

```tsx
{!blocked && <FollowButton profileId={profileId} initialFollowing={isFollowing} />}
```

- [ ] **Step 4: Wire counts + links into `ProfileHeader`**

In `components/player/ProfileHeader.tsx`, add `import Link from 'next/link'` (already imported). After the `<div className="mt-1 flex flex-wrap ...">` block (season rank / coin balance row) and before the bio paragraph, add:

```tsx
<div className="mt-2 flex items-center justify-center gap-4 text-sm sm:justify-start">
  <Link href={`/players/${profile.username}/followers`} className="text-sx-gray hover:text-white">
    <span className="font-bold text-white">{profile.followerCount}</span> Followers
  </Link>
  <Link href={`/players/${profile.username}/following`} className="text-sx-gray hover:text-white">
    <span className="font-bold text-white">{profile.followingCount}</span> Following
  </Link>
</div>
```

Pass `isFollowing` through to `ProfilePlayerActions` — add an `isFollowing: boolean` prop to `ProfileHeader` itself and thread it:

```tsx
export function ProfileHeader({
  profile,
  viewerId,
  friendshipStatus,
  isFollowing,
  coinBalance,
  achievements,
  avatarFrameUrl,
  profileThemeClass,
  usernameColourClass,
  messagingState,
}: {
  profile: ProfileView
  viewerId: string | null
  friendshipStatus: FriendshipStatus
  isFollowing: boolean
  ...
```

```tsx
{viewerId && !isOwner && (
  <ProfilePlayerActions
    profileId={profile.id}
    friendshipStatus={friendshipStatus}
    blockedByMe={messagingState?.blockedByMe ?? false}
    isFollowing={isFollowing}
  />
)}
```

- [ ] **Step 5: Fetch counts + follow state in the profile page**

In `app/[locale]/(public)/players/[username]/page.tsx`:

```ts
import { fetchFollowCounts, fetchIsFollowing } from '@/lib/follows/query'
```

Add two entries to the existing `Promise.all([...])` array (after `rawProfilePosts`'s query):

```ts
    fetchFollowCounts(p.id),
```

and destructure it as `followCounts` in the array on the left (`{ data: rawProfilePosts }, followCounts`). Then, alongside the existing `friendship`/`messagingState` computation (which already branches on `user && user.id !== p.id`):

```ts
  const isFollowingProfile = user && user.id !== p.id ? await fetchIsFollowing(user.id, p.id) : false
```

In the `profile: ProfileView = { ... }` object literal, add:

```ts
    followerCount: followCounts.followers,
    followingCount: followCounts.following,
```

And pass `isFollowing={isFollowingProfile}` to `<ProfileHeader>`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add lib/players/profile.ts "app/[locale]/(public)/players/[username]/page.tsx" components/player/ProfileHeader.tsx components/player/ProfilePlayerActions.tsx components/player/FollowButton.tsx
git commit -m "feat(follows): Follow button + follower/following counts on profile

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 6: Followers / Following list pages

**Files:**
- Create: `app/[locale]/(public)/players/[username]/followers/page.tsx`
- Create: `app/[locale]/(public)/players/[username]/following/page.tsx`

**Interfaces:**
- Consumes: `fetchFollowers`, `fetchFollowing`, `FollowListEntry` (Task 3).

Deliberately minimal per the spec's cuttable-corner note: no inline follow/unfollow control on the row, just avatar + name linking to the profile.

- [ ] **Step 1: Write the followers page**

Create `app/[locale]/(public)/players/[username]/followers/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchFollowers, type FollowListEntry } from '@/lib/follows/query'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import type { MembershipTier } from '@/lib/membership/tiers'

async function loadNamedProfile(username: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, deleted_at')
    .eq('username', username)
    .maybeSingle()
  if (!data || data.deleted_at) return null
  return data
}

export async function generateMetadata({ params }: { params: { username: string; locale: Locale } }): Promise<Metadata> {
  const p = await loadNamedProfile(params.username)
  if (!p) return { title: 'Player not found — SentinelX Esports' }
  const name = p.display_name ?? p.username
  return buildMetadata({
    title: `${name}'s Followers — SentinelX Esports`,
    description: `Players following ${name} on Sentinel X.`,
    path: `/players/${p.username}/followers`,
    locale: params.locale,
  })
}

export default async function FollowersPage({ params }: { params: { username: string } }) {
  const p = await loadNamedProfile(params.username)
  if (!p) notFound()
  const name = p.display_name ?? p.username
  const followers = await fetchFollowers(p.id)

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 sm:px-6">
      <nav className="py-4 text-xs text-sx-gray">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-1.5">›</span>
        <Link href={`/players/${p.username}`} className="hover:text-white">{name}</Link>
        <span className="mx-1.5">›</span>
        <span className="text-white">Followers</span>
      </nav>
      <h1 className="mb-4 font-display text-xl font-black text-white">Followers</h1>
      {followers.length === 0 ? (
        <EmptyState icon="👥" title="No followers yet" body={`${name} doesn't have any followers yet.`} />
      ) : (
        <FollowList entries={followers} />
      )}
    </div>
  )
}

function FollowList({ entries }: { entries: FollowListEntry[] }) {
  return (
    <ul className="divide-y divide-sx-border rounded-xl border border-sx-border bg-sx-surface">
      {entries.map((e) => (
        <li key={e.id}>
          <Link href={`/players/${e.username}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sx-bg">
            <HexAvatar
              src={e.avatarUrl}
              username={e.displayName ?? e.username ?? ''}
              tier={(e.membershipTier ?? 'recruit') as MembershipTier}
              size="sm"
            />
            <span className="truncate font-semibold text-white">{e.displayName ?? e.username}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Write the following page**

Create `app/[locale]/(public)/players/[username]/following/page.tsx` — identical structure, swapping `fetchFollowers` for `fetchFollowing`, the breadcrumb's last crumb to `Following`, the `<h1>` to `Following`, and the empty-state copy to `` `${name} isn't following anyone yet.` ``:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchFollowing, type FollowListEntry } from '@/lib/follows/query'
import { HexAvatar } from '@/components/shared/HexAvatar'
import { EmptyState } from '@/components/shared/EmptyState'
import { buildMetadata } from '@/lib/seo/metadata'
import type { Locale } from '@/i18n/locales'
import type { MembershipTier } from '@/lib/membership/tiers'

async function loadNamedProfile(username: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, deleted_at')
    .eq('username', username)
    .maybeSingle()
  if (!data || data.deleted_at) return null
  return data
}

export async function generateMetadata({ params }: { params: { username: string; locale: Locale } }): Promise<Metadata> {
  const p = await loadNamedProfile(params.username)
  if (!p) return { title: 'Player not found — SentinelX Esports' }
  const name = p.display_name ?? p.username
  return buildMetadata({
    title: `Players ${name} Follows — SentinelX Esports`,
    description: `Players ${name} follows on Sentinel X.`,
    path: `/players/${p.username}/following`,
    locale: params.locale,
  })
}

export default async function FollowingPage({ params }: { params: { username: string } }) {
  const p = await loadNamedProfile(params.username)
  if (!p) notFound()
  const name = p.display_name ?? p.username
  const following = await fetchFollowing(p.id)

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 sm:px-6">
      <nav className="py-4 text-xs text-sx-gray">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-1.5">›</span>
        <Link href={`/players/${p.username}`} className="hover:text-white">{name}</Link>
        <span className="mx-1.5">›</span>
        <span className="text-white">Following</span>
      </nav>
      <h1 className="mb-4 font-display text-xl font-black text-white">Following</h1>
      {following.length === 0 ? (
        <EmptyState icon="👥" title="Not following anyone yet" body={`${name} isn't following anyone yet.`} />
      ) : (
        <FollowList entries={following} />
      )}
    </div>
  )
}

function FollowList({ entries }: { entries: FollowListEntry[] }) {
  return (
    <ul className="divide-y divide-sx-border rounded-xl border border-sx-border bg-sx-surface">
      {entries.map((e) => (
        <li key={e.id}>
          <Link href={`/players/${e.username}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sx-bg">
            <HexAvatar
              src={e.avatarUrl}
              username={e.displayName ?? e.username ?? ''}
              tier={(e.membershipTier ?? 'recruit') as MembershipTier}
              size="sm"
            />
            <span className="truncate font-semibold text-white">{e.displayName ?? e.username}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add "app/[locale]/(public)/players/[username]/followers/page.tsx" "app/[locale]/(public)/players/[username]/following/page.tsx"
git commit -m "feat(follows): followers/following list pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 7: Feed — "Following" tab

**Files:**
- Modify: `components/community/FeedFilters.tsx`
- Modify: `components/community/FeedList.tsx`
- Modify: `app/[locale]/(public)/community/page.tsx`

**Interfaces:**
- Consumes: `fetchFollowingIds` (Task 3).

- [ ] **Step 1: Add the `following` tab to `FeedFilters`**

Rewrite `components/community/FeedFilters.tsx`:

```tsx
'use client'

export type FeedFilter = 'all' | 'following' | 'results' | 'announcements' | 'achievements'

const BASE_TABS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'results', label: 'Results' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'achievements', label: 'Achievements' },
]

// Client-side filter over already-loaded posts — no refetch (spec §4). The
// Following tab follows the same rule as the rest: it filters the current
// page, it does not fetch a fresh one — matching the existing limitation of
// Results/Announcements/Achievements (none of them page past what's loaded
// either).
export function FeedFilters({
  active,
  onChange,
  showFollowing,
}: {
  active: FeedFilter
  onChange: (f: FeedFilter) => void
  showFollowing: boolean
}) {
  const tabs = showFollowing
    ? [BASE_TABS[0], { key: 'following' as const, label: 'Following' }, ...BASE_TABS.slice(1)]
    : BASE_TABS
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
            active === t.key ? 'border-sx-purple/40 bg-sx-purple/20 text-sx-purple-text' : 'border-sx-border bg-sx-surface text-sx-gray hover:border-sx-gray'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Filter on `followingIds` in `FeedList`**

Modify `components/community/FeedList.tsx`:

```tsx
'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import type { PostView } from '@/lib/community/feed-query'
import { loadMorePosts } from '@/lib/community/load-more-action'
import { PostCard } from './PostCard'
import { FeedFilters, type FeedFilter } from './FeedFilters'
import { EmptyState } from '@/components/shared/EmptyState'

function matchesFilter(post: PostView, filter: FeedFilter, followingIds: Set<string>): boolean {
  if (filter === 'all') return true
  if (filter === 'following') return post.author.id != null && followingIds.has(post.author.id)
  if (filter === 'results') return post.postType === 'match_result'
  if (filter === 'announcements') return post.postType === 'announcement'
  if (filter === 'achievements') return post.postType === 'achievement'
  return true
}

export function FeedList({
  pinned,
  initialPosts,
  initialHasMore,
  loggedIn,
  followingIds = [],
}: {
  pinned: PostView[]
  initialPosts: PostView[]
  initialHasMore: boolean
  loggedIn: boolean
  /** Ids the viewer follows — drives the Following tab. Empty/omitted when logged out. */
  followingIds?: string[]
}) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [posts, setPosts] = useState(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, startTransition] = useTransition()
  const followingIdSet = useMemo(() => new Set(followingIds), [followingIds])

  // A fresh initialPosts identity means the server re-fetched page 1 (e.g.
  // after creating a post triggers router.refresh()) — resync, collapsing
  // any "loaded more" pages back to page 1. Acceptable tradeoff for Phase 3.
  useEffect(() => {
    setPosts(initialPosts)
    setHasMore(initialHasMore)
  }, [initialPosts, initialHasMore])

  function onLoadMore() {
    startTransition(async () => {
      const page = await loadMorePosts(posts.length)
      setPosts((prev) => [...prev, ...page.posts])
      setHasMore(page.hasMore)
    })
  }

  const visiblePinned = pinned.filter((p) => matchesFilter(p, filter, followingIdSet))
  const visiblePosts = posts.filter((p) => matchesFilter(p, filter, followingIdSet))
  const noPosts = visiblePinned.length === 0 && visiblePosts.length === 0

  return (
    <div>
      <FeedFilters active={filter} onChange={setFilter} showFollowing={loggedIn} />

      {noPosts ? (
        filter === 'following' ? (
          <EmptyState
            icon="👋"
            title="Follow players to see their posts here"
            body="Visit a player's profile and tap Follow — their posts will show up in this tab."
          />
        ) : (
          <EmptyState icon="💬" title="No posts yet" body="Be the first to say something." />
        )
      ) : (
        <div className="space-y-3">
          {visiblePinned.map((p) => (
            <PostCard key={p.id} post={p} loggedIn={loggedIn} />
          ))}
          {visiblePosts.map((p) => (
            <PostCard key={p.id} post={p} loggedIn={loggedIn} />
          ))}
        </div>
      )}

      {hasMore && filter === 'all' && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={pending}
            className="rounded-lg border border-sx-border px-5 py-2 text-xs font-bold text-sx-gray hover:border-sx-purple/40 hover:text-sx-white disabled:opacity-50"
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Fetch `followingIds` and pass them in on the community page**

In `app/[locale]/(public)/community/page.tsx`:

```ts
import { fetchFollowingIds } from '@/lib/follows/query'
```

Add one entry to the `Promise.all([...])` array (after `fetchStatusRings(viewerId)`):

```ts
    viewerId ? fetchFollowingIds(viewerId) : Promise.resolve([] as string[]),
```

Destructure it as `followingIds` in the array on the left (after `statusRings`). Pass it to `FeedList`:

```tsx
<FeedList pinned={pinned} initialPosts={posts} initialHasMore={hasMore} loggedIn={!!viewerId} followingIds={followingIds} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add components/community/FeedFilters.tsx components/community/FeedList.tsx "app/[locale]/(public)/community/page.tsx"
git commit -m "feat(follows): Following tab on the community feed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TPv6ugzjfWaWBXSBrqHydq"
```

---

## Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all green, including the new `lib/follows/predicates.test.ts`.

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit
npx next lint
```

Expected: both clean.

- [ ] **Step 3: Manual E2E — follow/unfollow + counts**

On a local/preview build, logged in as Player A:
1. Visit Player B's profile. Confirm a "Follow" button shows (not "Following"), and Follower/Following counts render.
2. Click Follow. Confirm it becomes "Following", and B's follower count increments by 1 on refresh.
3. Visit `/players/B/followers`. Confirm A appears in the list, linking to A's profile.
4. Visit A's own profile → `/players/A/following`. Confirm B appears.
5. Click "Following" again to unfollow. Confirm counts drop back down and both list pages update.
6. Try to follow yourself is not reachable from the UI (no Follow button on your own profile) — confirmed by inspection of Task 5 Step 3's `!isOwner` gating already in place on the page.

- [ ] **Step 4: Manual E2E — feed Following tab**

1. As Player A (following at least one other player, e.g. B), open `/community`.
2. Confirm a "Following" tab appears between "All" and "Results".
3. Click it. Confirm only posts authored by B (and anyone else A follows) show, if any are in the currently loaded page.
4. Unfollow everyone (or use a fresh account that follows nobody) and confirm the tab shows the "Follow players to see their posts here" empty state, not a blank page.
5. Log out, reload `/community`. Confirm the Following tab does not appear at all.

- [ ] **Step 5: Manual E2E — blocking severs follows**

1. As A, follow B. As B, follow A (mutual).
2. As A, block B (from B's profile).
3. Confirm A no longer follows B and B no longer follows A (check both `/followers` and `/following` pages for both accounts).
4. As B (still blocked by A), attempt to follow A again from A's profile — confirm it fails with "You cannot follow this player." (or the Follow button is simply not shown, per the existing `!blocked`-gated Message-button pattern — note whichever the UI actually does here, since B's own `blocked` state reflects "did I block them", not "did they block me").
5. Unblock, confirm following each other again is possible.

- [ ] **Step 6: Report results**

Summarize the manual E2E outcomes (pass/fail per step) before considering this plan done. Any step that fails goes back through `superpowers:systematic-debugging`, not a quick patch.
