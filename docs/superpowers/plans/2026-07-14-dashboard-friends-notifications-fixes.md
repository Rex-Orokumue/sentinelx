# Dashboard, Friends & Notifications Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap that makes the friend/friendly-match system unusable end-to-end (no player discovery, dead-end notifications, no friendlies destination), fix stale-data bugs in the notification bell/admin dashboard/avatar, and shrink the dashboard with collapsible sections.

**Architecture:** No new tables — `friends`, `friendly_matches`, and `profiles` already have everything needed (migration `023_friends_and_friendly_matches.sql`). This is almost entirely UI wiring: a new `/players` directory page (the public `/players/[username]` profile page and its Add Friend / Challenge buttons already exist and are the reason `lib/friends/list.ts`'s `isFriendsWith`/`sortFriendsFirst` helpers exist unused today), a new `/dashboard/friendlies` list page, `notifyInApp()` call-site link fixes, a self-refetching notification bell, and a shared `CollapsibleSection` wrapper around the existing dashboard panels.

**Tech Stack:** Next.js 14.2.35 App Router (Server Components, Server Actions), Supabase (Postgres + RLS), TypeScript, Tailwind, Vitest.

## Global Constraints

- This codebase's established test convention (confirmed across 50+ existing `*.test.ts` files) is: unit tests with TDD **only** for pure functions in `lib/`; Server Actions, Next.js pages, and React components have **no** test files and are verified via `npx tsc --noEmit`, `npm run lint`, `npm run test` (full suite), and a manual dev-server smoke check. Do not invent component/page tests where the rest of the repo has none — follow the established pattern.
- Use Next.js Server Components by default; add `"use client"` only where a step below needs `useState`/`useEffect`/browser APIs.
- Every new/changed Supabase query goes through the regular RLS-scoped client (`lib/supabase/server` or `lib/supabase/client`), never `createAdminClient`, unless already inside an existing admin-only action.
- Mobile-first Tailwind styling matching the existing dashboard/profile visual language (`rounded-2xl border border-slate-800 bg-slate-900 p-4`, `text-slate-400/500`, `bg-violet-600` primary buttons) — copy classes from neighboring components rather than inventing new ones.
- Next.js version is 14.2.35, whose Client Router Cache retains a **dynamically rendered** route's RSC payload client-side for 30s by default on soft (`<Link>`/`router.push`) navigation, regardless of `export const dynamic = 'force-dynamic'` (that export only controls server-side full-route-caching, not the client cache). Task 6 sets `experimental.staleTimes.dynamic = 0` in `next.config.mjs` for this reason — `force-dynamic` alone would not fix the reported admin staleness.
- Line numbers cited throughout this plan reflect each file's state as read during planning (2026-07-14) and are a locator aid, not a guarantee — `Read` the current file content immediately before each `Edit` and match by surrounding code, not by line number alone (earlier tasks in this plan also shift later files' line numbers as they land).

---

### Task 1: Player discovery page (`/players`)

**Files:**
- Create: `components/player/PlayerCard.tsx`
- Create: `app/(public)/players/page.tsx`
- Modify: `components/shared/SiteHeader.tsx`
- Modify: `components/shared/AccountMenu.tsx`
- Modify: `components/shared/BottomTabBar.tsx`

**Interfaces:**
- Consumes: `Avatar` (`components/shared/Avatar.tsx`), `TierBadge` (`components/player/TierBadge.tsx`), `createClient` (`lib/supabase/server.ts`).
- Produces: `PlayerCardData` type, `PlayerCard` component — the existing `/players/[username]` profile page (with its `AddFriendButton`/`ChallengeButton`) is the link target, unchanged.

**Pre-verified during planning (no action needed, noted so Task 1 doesn't re-derive it):** `app/(public)/players/[username]/page.tsx` renders `<ProfileHeader profile={profile} viewerId={user?.id ?? null} />`, and `components/player/ProfileHeader.tsx` lines 38–43 already render both buttons — `{viewerId && viewerId !== profile.id && (<><AddFriendButton recipientId={profile.id} /><ChallengeButton opponentId={profile.id} /></>)}` — backed by working Server Actions (`lib/friends/actions.ts`'s `sendFriendRequest`, `lib/friendly-matches/actions.ts`'s `sendChallenge`). Confirmed present and wired; `/players` will not link to a dead end.

- [ ] **Step 1: Write `PlayerCard`**

```tsx
import Link from 'next/link'
import { Avatar } from '@/components/shared/Avatar'
import { TierBadge } from '@/components/player/TierBadge'

export interface PlayerCardData {
  username: string
  display_name: string | null
  avatar_url: string | null
  sentinel_score: number
  sentinel_tier: string | null
}

export function PlayerCard({ player }: { player: PlayerCardData }) {
  return (
    <Link
      href={`/players/${player.username}`}
      className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
    >
      <Avatar
        avatarUrl={player.avatar_url}
        displayName={player.display_name}
        username={player.username}
        size={44}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-white">{player.display_name ?? player.username}</p>
        <p className="truncate text-xs text-slate-500">@{player.username}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-white">
          {player.sentinel_score}
          <span className="text-slate-500">/100</span>
        </p>
        <TierBadge tier={player.sentinel_tier} />
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Write the `/players` page**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { PlayerCard, type PlayerCardData } from '@/components/player/PlayerCard'

export const metadata: Metadata = { title: 'Players · SentinelX Esports' }

const PLAYER_COLS = 'username, display_name, avatar_url, sentinel_score, sentinel_tier'

export default async function PlayersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim()
  const supabase = createClient()

  let query = supabase
    .from('profiles')
    .select(PLAYER_COLS)
    .order('sentinel_score', { ascending: false })
    .limit(60)
  if (q) {
    // Escape ilike wildcards so a literal "%"/"_" in a search term can't
    // widen the match beyond what the user typed.
    const escaped = q.replace(/[%_]/g, (c) => `\\${c}`)
    query = query.or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
  }
  const { data } = await query
  const players = (data ?? []) as PlayerCardData[]

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <h1 className="mb-6 text-xl font-black text-white">Players</h1>
      <form action="/players" className="mb-6">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by username or name…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </form>
      {players.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No players found.
        </p>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <PlayerCard key={p.username} player={p} />
          ))}
        </div>
      )}
    </div>
  )
}
```

A plain `<form action="/players">` with no `method` attribute defaults to GET, which Next.js turns into a normal navigation to `/players?q=...` — no client JS needed for search.

- [ ] **Step 3: Add `/players` to the desktop nav**

In `components/shared/SiteHeader.tsx`, extend the `NAV` array (line 8):

```typescript
const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/tv', label: 'TV' },
  { href: '/community', label: 'Community' },
  { href: '/exchange', label: 'Exchange' },
  { href: '/rankings', label: 'Rankings' },
  { href: '/players', label: 'Players' },
]
```

- [ ] **Step 4: Add "Players" to the mobile/account dropdowns**

In `components/shared/AccountMenu.tsx`, add a `MenuLink` after "My Profile" (after line 68):

```tsx
          <MenuLink
            href={session.username ? `/players/${session.username}` : '/dashboard'}
            onNavigate={() => setOpen(false)}
          >
            My Profile
          </MenuLink>
          <MenuLink href="/players" onNavigate={() => setOpen(false)}>Find Players</MenuLink>
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>Dashboard</MenuLink>
```

In `components/shared/BottomTabBar.tsx`, make the same addition to its dropdown (after line 95):

```tsx
                <MenuLink
                  href={session.username ? `/players/${session.username}` : '/dashboard'}
                  onNavigate={() => setMenuOpen(false)}
                >
                  My Profile
                </MenuLink>
                <MenuLink href="/players" onNavigate={() => setMenuOpen(false)}>Find Players</MenuLink>
                <MenuLink href="/dashboard" onNavigate={() => setMenuOpen(false)}>Dashboard</MenuLink>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

Start the dev server (`npm run dev`) and open `/players` — confirm the search box filters by username/display name and each card links to `/players/[username]` with a working Add Friend / Challenge button.

- [ ] **Step 6: Commit**

```bash
git add components/player/PlayerCard.tsx "app/(public)/players/page.tsx" components/shared/SiteHeader.tsx components/shared/AccountMenu.tsx components/shared/BottomTabBar.tsx
git commit -m "feat: add /players discovery page and nav entries"
```

---

### Task 2: Friend list usernames + avatars clickable

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `components/dashboard/FriendsPanel.tsx`

**Interfaces:**
- Consumes: `Avatar` (`components/shared/Avatar.tsx`).
- Produces: `FriendRequestRow`/`FriendRow` gain an `avatarUrl` field — no other consumer exists today.

- [ ] **Step 1: Fetch `avatar_url` in the dashboard's friends query**

In `app/dashboard/page.tsx`, update the `friends` query (lines 133–140):

```typescript
    supabase
      .from('friends')
      .select(
        'id, requester_id, recipient_id, status, ' +
          'requester:profiles!friends_requester_id_fkey(username, display_name, avatar_url), ' +
          'recipient:profiles!friends_recipient_id_fkey(username, display_name, avatar_url)',
      )
      .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`),
```

Update `FriendProfileRef` and `friendProfileName` (lines 48–55):

```typescript
type FriendProfileRef =
  | { username: string | null; display_name: string | null; avatar_url: string | null }
  | { username: string | null; display_name: string | null; avatar_url: string | null }[]
  | null
function friendProfileName(p: FriendProfileRef): { name: string; username: string | null; avatarUrl: string | null } {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return { name: r?.display_name ?? r?.username ?? 'Player', username: r?.username ?? null, avatarUrl: r?.avatar_url ?? null }
}
```

Update the `rawFriends` cast shape (lines 256–263) — the embedded `requester`/`recipient` fields now carry `avatar_url` automatically via the updated `FriendProfileRef`, so only the row-building maps need the new field (lines 264–276):

```typescript
  const incomingRequests: FriendRequestRow[] = rawFriends
    .filter((f) => f.status === 'pending' && f.recipient_id === user.id)
    .map((f) => {
      const p = friendProfileName(f.requester)
      return { id: f.id, requesterName: p.name, requesterUsername: p.username, requesterAvatarUrl: p.avatarUrl }
    })
  const friendsList: FriendRow[] = rawFriends
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const otherIsRequester = f.recipient_id === user.id
      const p = friendProfileName(otherIsRequester ? f.requester : f.recipient)
      return { id: f.id, friendName: p.name, friendUsername: p.username, friendAvatarUrl: p.avatarUrl }
    })
```

- [ ] **Step 2: Wrap names/avatars in `Link` in `FriendsPanel`**

Rewrite `components/dashboard/FriendsPanel.tsx`:

```tsx
'use client'
import Link from 'next/link'
import { useFormState } from 'react-dom'
import {
  acceptFriendRequest,
  removeFriend,
  type FriendActionState,
} from '@/lib/friends/actions'
import { Avatar } from '@/components/shared/Avatar'

export interface FriendRequestRow {
  id: string
  requesterName: string
  requesterUsername: string | null
  requesterAvatarUrl: string | null
}

export interface FriendRow {
  id: string
  friendName: string
  friendUsername: string | null
  friendAvatarUrl: string | null
}

export function FriendsPanel({
  incoming,
  friends,
}: {
  incoming: FriendRequestRow[]
  friends: FriendRow[]
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Friends</h2>

      {incoming.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Requests</p>
          {incoming.map((r) => (
            <IncomingRequestRow key={r.id} req={r} />
          ))}
        </div>
      )}

      {friends.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No friends yet — send a request from a player's profile.
        </p>
      ) : (
        <div className="space-y-2">
          {friends.map((f) => (
            <FriendRow key={f.id} friend={f} />
          ))}
        </div>
      )}
    </section>
  )
}

function ProfileLink({
  username,
  avatarUrl,
  name,
}: {
  username: string | null
  avatarUrl: string | null
  name: string
}) {
  const label = (
    <>
      <Avatar avatarUrl={avatarUrl} displayName={name} username={username} size={32} />
      <p className="min-w-0 truncate text-sm font-semibold text-white">
        {name} {username ? `(@${username})` : ''}
      </p>
    </>
  )
  if (!username) {
    return <div className="flex min-w-0 items-center gap-2">{label}</div>
  }
  return (
    <Link href={`/players/${username}`} className="flex min-w-0 items-center gap-2 hover:opacity-80">
      {label}
    </Link>
  )
}

function IncomingRequestRow({ req }: { req: FriendRequestRow }) {
  const [state, action] = useFormState<FriendActionState, FormData>(acceptFriendRequest, undefined)
  const [declineState, declineAction] = useFormState<FriendActionState, FormData>(removeFriend, undefined)
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <ProfileLink username={req.requesterUsername} avatarUrl={req.requesterAvatarUrl} name={req.requesterName} />
      <div className="flex shrink-0 gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={req.id} />
          <button type="submit" className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500">
            Accept
          </button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="id" value={req.id} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500">
            Decline
          </button>
        </form>
      </div>
      {(state?.error || declineState?.error) && (
        <p className="text-xs text-red-400">{state?.error || declineState?.error}</p>
      )}
    </div>
  )
}

function FriendRow({ friend }: { friend: FriendRow }) {
  const [state, action] = useFormState<FriendActionState, FormData>(removeFriend, undefined)
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <ProfileLink username={friend.friendUsername} avatarUrl={friend.friendAvatarUrl} name={friend.friendName} />
      <form action={action}>
        <input type="hidden" name="id" value={friend.id} />
        <button type="submit" className="shrink-0 text-xs font-semibold text-red-400 hover:text-red-300">
          Remove
        </button>
      </form>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx components/dashboard/FriendsPanel.tsx
git commit -m "fix: make friend list usernames and avatars link to their profile"
```

---

### Task 3: Friendly challenge notification links to the Match Room

**Files:**
- Modify: `lib/friendly-matches/actions.ts`

- [ ] **Step 1: Point the challenge notification at the match room**

In `sendChallenge` (`lib/friendly-matches/actions.ts`, lines 40–48), change the `link`:

```typescript
  await notifyInApp({
    playerId: parsed.data.opponentId,
    type: 'friend_request', // reuses the friend_request bell type — a challenge is a social invite, same category
    title: stakeAmount ? 'Staked challenge received' : 'Friendly challenge received',
    body: stakeAmount
      ? `You've been challenged to a ₦${stakeAmount} staked friendly.`
      : "You've been challenged to a friendly match.",
    link: `/dashboard/friendlies/${created.id}`,
  })
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add lib/friendly-matches/actions.ts
git commit -m "fix: friendly challenge notification links to the match room, not /dashboard"
```

---

### Task 4: `/dashboard/friendlies` list page + dashboard panel + nav entries

**Files:**
- Create: `lib/friendly-matches/buckets.ts`
- Create: `lib/friendly-matches/buckets.test.ts`
- Create: `app/dashboard/friendlies/page.tsx`
- Create: `components/dashboard/FriendliesPanel.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `components/shared/AccountMenu.tsx`
- Modify: `components/shared/BottomTabBar.tsx`

**Interfaces:**
- Produces: `bucketFriendlies(rows, viewerId)` — pure classification helper, consumed by both the new list page and the dashboard summary panel.

- [ ] **Step 1: Write the failing test for the bucketing helper**

```typescript
import { describe, it, expect } from 'vitest'
import { bucketFriendlies, type FriendlyMatchRow } from './buckets'

function m(over: Partial<FriendlyMatchRow> & { id: string }): FriendlyMatchRow {
  return {
    status: 'pending',
    challengerId: 'me',
    opponentId: 'them',
    ...over,
  }
}

describe('bucketFriendlies', () => {
  it('puts "pending" rows in pending regardless of which side the viewer is on', () => {
    const r = bucketFriendlies(
      [m({ id: 'a', status: 'pending', challengerId: 'me', opponentId: 'them' }),
       m({ id: 'b', status: 'pending', challengerId: 'them', opponentId: 'me' })],
      'me',
    )
    expect(r.pending.map((f) => f.id).sort()).toEqual(['a', 'b'])
    expect(r.active).toEqual([])
    expect(r.completed).toEqual([])
  })

  it('groups awaiting_payment / active / awaiting_admin_confirmation as active', () => {
    const r = bucketFriendlies(
      [
        m({ id: 'a', status: 'awaiting_payment' }),
        m({ id: 'b', status: 'active' }),
        m({ id: 'c', status: 'awaiting_admin_confirmation' }),
      ],
      'me',
    )
    expect(r.active.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('groups completed / declined / disputed as completed', () => {
    const r = bucketFriendlies(
      [
        m({ id: 'a', status: 'completed' }),
        m({ id: 'b', status: 'declined' }),
        m({ id: 'c', status: 'disputed' }),
      ],
      'me',
    )
    expect(r.completed.map((f) => f.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/friendly-matches/buckets.test.ts`
Expected: FAIL — `Cannot find module './buckets'`

- [ ] **Step 3: Write the implementation**

```typescript
export interface FriendlyMatchRow {
  id: string
  status: string
  challengerId: string
  opponentId: string
}

const ACTIVE_STATUSES = new Set(['awaiting_payment', 'active', 'awaiting_admin_confirmation'])
const DONE_STATUSES = new Set(['completed', 'declined', 'disputed'])

export function bucketFriendlies<T extends FriendlyMatchRow>(
  rows: T[],
  _viewerId: string,
): { pending: T[]; active: T[]; completed: T[] } {
  return {
    pending: rows.filter((r) => r.status === 'pending'),
    active: rows.filter((r) => ACTIVE_STATUSES.has(r.status)),
    completed: rows.filter((r) => DONE_STATUSES.has(r.status)),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/friendly-matches/buckets.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the `/dashboard/friendlies` list page**

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bucketFriendlies, type FriendlyMatchRow } from '@/lib/friendly-matches/buckets'

export const metadata: Metadata = { title: 'Friendlies · SentinelX Esports' }

type ProfileRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function first(p: ProfileRef) {
  return Array.isArray(p) ? p[0] ?? null : p
}
function nameOf(p: ReturnType<typeof first>): string {
  return p?.display_name ?? p?.username ?? 'Player'
}

type Row = FriendlyMatchRow & {
  stake_amount: number | null
  challenger: ProfileRef
  opponent: ProfileRef
}

export default async function FriendliesPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/dashboard/friendlies')

  const { data: raw } = await supabase
    .from('friendly_matches')
    .select(
      'id, status, stake_amount, challenger_id, opponent_id, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
    )
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  const rows = ((raw as unknown[] | null) ?? []).map((r) => {
    const row = r as {
      id: string
      status: string
      stake_amount: number | null
      challenger_id: string
      opponent_id: string
      challenger: ProfileRef
      opponent: ProfileRef
    }
    return { ...row, challengerId: row.challenger_id, opponentId: row.opponent_id } as Row
  })
  const { pending, active, completed } = bucketFriendlies(rows, user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-6">
      <h1 className="mb-6 text-xl font-black text-white">Friendlies</h1>
      <Group title="Pending" rows={pending} viewerId={user.id} empty="No pending challenges." />
      <Group title="Active" rows={active} viewerId={user.id} empty="No active friendlies." />
      <Group title="Completed" rows={completed} viewerId={user.id} empty="No completed friendlies yet." />
    </div>
  )
}

function Group({
  title,
  rows,
  viewerId,
  empty,
}: {
  title: string
  rows: Row[]
  viewerId: string
  empty: string
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-center text-sm text-slate-500">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isChallenger = r.challengerId === viewerId
            const opponent = isChallenger ? first(r.opponent) : first(r.challenger)
            return (
              <Link
                key={r.id}
                href={`/dashboard/friendlies/${r.id}`}
                className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
              >
                <p className="font-bold text-white">vs {nameOf(opponent)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {r.stake_amount ? `₦${r.stake_amount} stake` : 'Free friendly'} · {r.status}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Write the compact dashboard summary panel**

```tsx
import Link from 'next/link'

export function FriendliesPanel({
  pendingCount,
  activeCount,
  completedCount,
}: {
  pendingCount: number
  activeCount: number
  completedCount: number
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm text-slate-300">
        {pendingCount} pending · {activeCount} active · {completedCount} completed
      </p>
      <Link
        href="/dashboard/friendlies"
        className="mt-3 inline-block rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        View friendlies →
      </Link>
    </div>
  )
}
```

- [ ] **Step 7: Wire counts + the panel into the main dashboard**

In `app/dashboard/page.tsx`, add `bucketFriendlies` and `FriendliesPanel` imports, add a lightweight parallel query to the existing `Promise.all` array (right after the `friends` query, line 140):

```typescript
    supabase
      .from('friendly_matches')
      .select('id, status, challenger_id, opponent_id')
      .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`),
```

(destructure it as `friendliesRes` in the array on line 77, matching the existing `friendsRes` pattern)

After the existing `friendsList` block (after line 276), add:

```typescript
  const rawFriendlies = ((friendliesRes.data as unknown[] | null) ?? []).map((r) => {
    const row = r as { id: string; status: string; challenger_id: string; opponent_id: string }
    return { id: row.id, status: row.status, challengerId: row.challenger_id, opponentId: row.opponent_id }
  })
  const friendlyBuckets = bucketFriendlies(rawFriendlies, user.id)
```

Add the panel to the JSX, right after `<FriendsPanel ... />` (line 306):

```tsx
      <FriendliesPanel
        pendingCount={friendlyBuckets.pending.length}
        activeCount={friendlyBuckets.active.length}
        completedCount={friendlyBuckets.completed.length}
      />
```

- [ ] **Step 8: Add "Friendlies" to the account dropdowns**

In `components/shared/AccountMenu.tsx`, add after "Dashboard" (after line 69):

```tsx
          <MenuLink href="/dashboard" onNavigate={() => setOpen(false)}>Dashboard</MenuLink>
          <MenuLink href="/dashboard/friendlies" onNavigate={() => setOpen(false)}>Friendlies</MenuLink>
```

In `components/shared/BottomTabBar.tsx`, the same addition (after line 96):

```tsx
                <MenuLink href="/dashboard" onNavigate={() => setMenuOpen(false)}>Dashboard</MenuLink>
                <MenuLink href="/dashboard/friendlies" onNavigate={() => setMenuOpen(false)}>Friendlies</MenuLink>
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: no errors, full suite passes

- [ ] **Step 10: Commit**

```bash
git add lib/friendly-matches/buckets.ts lib/friendly-matches/buckets.test.ts app/dashboard/friendlies/page.tsx components/dashboard/FriendliesPanel.tsx app/dashboard/page.tsx components/shared/AccountMenu.tsx components/shared/BottomTabBar.tsx
git commit -m "feat: add /dashboard/friendlies list page, dashboard summary panel, and nav entries"
```

---

### Task 5: Notification bell refetches on navigation and after marking read

**Files:**
- Modify: `components/shared/NotificationBell.tsx`

**Pre-verified during planning:** `NotificationItem` (`lib/nav/session.ts` lines 4–12) already declares `id`, `type`, `title`, `body`, `link`, `read`, `createdAt` — every field the rewritten bell needs. No change to `lib/nav/session.ts` is required for this task; the import in Step 1 below reuses the type as-is.

- [ ] **Step 1: Rewrite the bell to self-refetch on pathname change and refresh after read**

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { NotificationItem } from '@/lib/nav/session'

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationItem[]
  initialUnreadCount: number
}) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  // The bell is mounted once in the root layout and persists across
  // client-side navigations — its initial props never re-run server-side
  // on a soft nav, so it must fetch its own fresh count/list on every
  // pathname change instead of trusting stale initial props.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const [{ count }, { data: rows }] = await Promise.all([
        supabase
          .from('player_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', user.id)
          .eq('read', false),
        supabase
          .from('player_notifications')
          .select('id, type, title, body, link, read, created_at')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return
      setUnreadCount(count ?? 0)
      setNotifications(
        (rows ?? []).map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.read,
          createdAt: n.created_at,
        })),
      )
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [pathname])

  async function onSelect(n: NotificationItem) {
    setOpen(false)
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
      const supabase = createClient()
      await supabase.from('player_notifications').update({ read: true }).eq('id', n.id)
      router.refresh()
    }
    if (n.link) router.push(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelect(n)}
                className={`block w-full px-4 py-3 text-left text-sm transition-colors hover:bg-slate-800 ${
                  n.read ? 'opacity-60' : ''
                }`}
              >
                <p className="font-semibold text-white">{n.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">{n.body}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

Manually verify in the dev server: log in, trigger a notification from another account/action, navigate between two pages without reloading, and confirm the bell's unread count updates without a hard reload.

- [ ] **Step 3: Commit**

```bash
git add components/shared/NotificationBell.tsx
git commit -m "fix: notification bell refetches unread count on navigation and after marking read"
```

---

### Task 6: Admin pages never serve stale cached data

**Files:**
- Modify: `app/admin/layout.tsx`
- Modify: `next.config.mjs`

- [ ] **Step 1: Force dynamic rendering on the admin layout**

In `app/admin/layout.tsx`, add the export at the top:

```typescript
import { requireStaff } from '@/lib/admin/auth'
import { ADMIN_NAV, visibleNav } from '@/lib/admin/nav'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { getAdminNotificationQueue } from '@/lib/admin/notification-queue'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
```

- [ ] **Step 2: Disable the client router cache for dynamic routes app-wide**

`force-dynamic` only prevents server-side full-route caching — it does not shorten how long Next 14.2's **client-side** Router Cache holds onto a dynamically-rendered page after a `<Link>`/`router.push` navigation (default 30s). Since every admin page is already implicitly dynamic (via `cookies()` in `lib/supabase/server.ts`) yet still requires a hard reload to see new data, the actual fix is disabling that client cache for dynamic routes. In `next.config.mjs`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@base-ui/react', 'tailwind-merge'],
  // Every admin (and dashboard) page is dynamically rendered because it reads
  // the session cookie — but Next 14.2's Client Router Cache still holds a
  // stale copy for 30s after a soft navigation by default. This app deals in
  // live operational data (pending withdrawals, disputes, notifications), so
  // dynamic routes must always be refetched on navigation instead.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
}

export default nextConfig
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: build succeeds with no new errors

Manually verify: with two browser tabs (one admin, one a test player), submit a withdrawal request as the player, then navigate between two admin pages (not reload) and confirm the new request appears without a hard reload.

- [ ] **Step 4: Commit**

```bash
git add app/admin/layout.tsx next.config.mjs
git commit -m "fix: admin pages always render fresh data instead of serving a stale client-cached copy"
```

---

### Task 7: Collapsible dashboard sections

**Files:**
- Create: `components/dashboard/CollapsibleSection.tsx`
- Modify: `components/dashboard/WalletPanel.tsx`
- Modify: `components/dashboard/ReferralPanel.tsx`
- Modify: `components/dashboard/DataSupportPanel.tsx`
- Modify: `components/dashboard/FriendsPanel.tsx`
- Modify: `components/dashboard/FixtureCard.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Produces: `CollapsibleSection` (client component: `{ id?, title, defaultOpen, summary?, children }`) — wraps the panel bodies below. Also establishes the `id="wallet"`/`id="referrals"`/`id="friends"`/`id="matches"`/`id="friendlies"` anchors that Task 8's notification links target.

- [ ] **Step 1: Write `CollapsibleSection`**

```tsx
'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export function CollapsibleSection({
  id,
  title,
  defaultOpen,
  summary,
  children,
}: {
  id?: string
  title: string
  defaultOpen: boolean
  summary?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-4 flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="text-base font-bold text-white">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {!open && summary && <span className="text-xs text-slate-500">{summary}</span>}
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {open && children}
    </section>
  )
}
```

`scroll-mt-20` keeps a `#wallet`-style deep link from landing directly under the sticky header.

- [ ] **Step 2: Strip the panels' own `<section>`/`<h2>` wrappers**

`WalletPanel.tsx` (lines 52–77) — replace the outer `<section>`/`<h2>` with a `<>` fragment:

```tsx
  return (
    <>
      <p className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-2xl font-black text-white">
        {formatNaira(balance)}
      </p>

      {mode === 'form' && <KycForm banks={banks} failureReason={kycFailureReason} />}
      {mode === 'pending' && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 text-center text-sm font-semibold text-sky-300">
          Verifying your identity — usually completes within a few minutes.
        </div>
      )}
      {mode === 'verified' && payoutAccount && (
        <VerifiedWithdrawalForm hasActive={hasActive} payoutAccount={payoutAccount} maxAmount={balance} />
      )}

      {requests.length > 0 && (
        <div className="mt-4 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </>
  )
```

`ReferralPanel.tsx` (lines 21–46) — same change, drop the outer `<section>`/`<h2>`:

```tsx
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-400">Your referral link</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-300">{link}</code>
        <button
          type="button"
          onClick={copyLink}
          className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <p className="mt-4 text-sm text-slate-300">
        {referralCount} referral{referralCount === 1 ? '' : 's'} — each one adds ₦100 to your wallet.
      </p>

      {referredPlayers.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Referred: {referredPlayers.join(', ')}</p>
      )}
    </div>
  )
```

`DataSupportPanel.tsx` (lines 4–44) — drop the outer `<section>`/`<h2>` and the `eligibility.length === 0` early return (the caller now decides whether to render the wrapper at all):

```tsx
import { buildDataSupportClaimUrl } from '@/lib/dashboard/data-support'
import type { DataSupportEligibility } from '@/lib/dashboard/data-support'

export function DataSupportPanel({
  username,
  eligibility,
}: {
  username: string
  eligibility: DataSupportEligibility[]
}) {
  return (
    <div className="space-y-2">
      {eligibility.map((e) => {
        const url = buildDataSupportClaimUrl({
          whatsapp: e.whatsapp,
          username,
          tournamentTitle: e.tournamentTitle,
          stage: e.stage,
        })
        return (
          <div key={e.tournamentId} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="font-bold text-white">{e.tournamentTitle}</p>
            <p className="mt-1 text-xs text-slate-400">{e.text}</p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-5 py-2.5 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
              >
                Claim Data Support
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

`FriendsPanel.tsx` — drop its own `<section className="mb-10">`/`<h2>Friends</h2>` wrapper (from Task 2's rewrite), keep everything else:

```tsx
  return (
    <>
      {incoming.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Requests</p>
          {incoming.map((r) => (
            <IncomingRequestRow key={r.id} req={r} />
          ))}
        </div>
      )}

      {friends.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
          No friends yet — send a request from a player's profile.
        </p>
      ) : (
        <div className="space-y-2">
          {friends.map((f) => (
            <FriendRow key={f.id} friend={f} />
          ))}
        </div>
      )}
    </>
  )
```

- [ ] **Step 3: Split `FixtureSection` into `ActiveFixtures` / `CompletedFixtures`**

In `components/dashboard/FixtureCard.tsx`, replace the `FixtureSection` export (lines 61–85) with two exports:

```tsx
export function ActiveFixtures({
  fixtures,
}: {
  fixtures: { live: DashboardFixture[]; upcoming: DashboardFixture[] }
}) {
  const total = fixtures.live.length + fixtures.upcoming.length
  if (total === 0) {
    return (
      <EmptyState
        icon="🎮"
        title="No active fixtures"
        body="Register for a tournament and your live/upcoming matches will show up here."
      />
    )
  }
  return (
    <div className="space-y-5">
      <Group label="Live" items={fixtures.live} />
      <Group label="Upcoming" items={fixtures.upcoming} />
    </div>
  )
}

export function CompletedFixtures({ fixtures }: { fixtures: DashboardFixture[] }) {
  if (fixtures.length === 0) {
    return <EmptyState icon="🏁" title="No completed matches yet" body="Finished matches will show up here." />
  }
  return <Group label="Completed" items={fixtures} />
}
```

- [ ] **Step 4: Wire `CollapsibleSection` around each panel in `app/dashboard/page.tsx`**

Replace the imports of `FixtureSection` with `ActiveFixtures, CompletedFixtures`, and add `CollapsibleSection`:

```typescript
import { ActiveFixtures, CompletedFixtures } from '@/components/dashboard/FixtureCard'
import { CollapsibleSection } from '@/components/dashboard/CollapsibleSection'
```

Replace the JSX block from `<ReferralPanel .../>` through `<WalletPanel .../>` (lines 304–320) with:

```tsx
      <CollapsibleSection
        id="referrals"
        title="Referrals"
        defaultOpen={false}
        summary={`${referredPlayers.length} referral${referredPlayers.length === 1 ? '' : 's'}`}
      >
        <ReferralPanel username={profile?.username ?? ''} referredPlayers={referredPlayers} />
      </CollapsibleSection>

      {dataSupportEligibility.length > 0 && (
        <CollapsibleSection title="Data support" defaultOpen={false}>
          <DataSupportPanel username={profile?.username ?? ''} eligibility={dataSupportEligibility} />
        </CollapsibleSection>
      )}

      <CollapsibleSection id="friends" title="Friends" defaultOpen={incomingRequests.length > 0}>
        <FriendsPanel incoming={incomingRequests} friends={friendsList} />
      </CollapsibleSection>

      <CollapsibleSection
        id="friendlies"
        title="Friendlies"
        defaultOpen={friendlyBuckets.pending.length > 0 || friendlyBuckets.active.length > 0}
        summary={`${friendlyBuckets.completed.length} completed`}
      >
        <FriendliesPanel
          pendingCount={friendlyBuckets.pending.length}
          activeCount={friendlyBuckets.active.length}
          completedCount={friendlyBuckets.completed.length}
        />
      </CollapsibleSection>

      <CollapsibleSection id="matches" title="Active matches" defaultOpen>
        <ActiveFixtures fixtures={{ live: fixtures.live, upcoming: fixtures.upcoming }} />
      </CollapsibleSection>
      <CollapsibleSection
        title="Completed matches"
        defaultOpen={false}
        summary={`${fixtures.completed.length} completed`}
      >
        <CompletedFixtures fixtures={fixtures.completed} />
      </CollapsibleSection>

      <MyTournaments registrations={registrations} />
      <MyListings listings={myListings} />
      <MyOrders orders={myOrders} />
      <MySales sales={mySales} />

      <CollapsibleSection id="wallet" title="Wallet" defaultOpen={walletBalance > 0 || hasActive}>
        <WalletPanel
          balance={walletBalance}
          requests={walletRequests}
          hasActive={hasActive}
          kycStatus={kyc?.kyc_status ?? 'unverified'}
          kycFailureReason={kyc?.kyc_failure_reason ?? null}
          banks={banks}
          payoutAccount={payoutAccount}
        />
      </CollapsibleSection>
```

(this replaces the standalone `<FriendliesPanel .../>` added in Task 4 Step 7 with the collapsible-wrapped version above, and replaces the old single `<FixtureSection fixtures={fixtures} />` line)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: no errors, full suite passes

Manually verify in the dev server: each collapsed section shows a chevron + (where applicable) a summary line, expands/collapses on click, and `Active matches`/pending `Friends`/`Friendlies` (when non-empty) start expanded while `Referrals`/`Data support`/`Completed matches` start collapsed.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/CollapsibleSection.tsx components/dashboard/WalletPanel.tsx components/dashboard/ReferralPanel.tsx components/dashboard/DataSupportPanel.tsx components/dashboard/FriendsPanel.tsx components/dashboard/FixtureCard.tsx app/dashboard/page.tsx
git commit -m "feat: collapsible dashboard sections with sensible expanded/collapsed defaults"
```

---

### Task 8: Notification deep links to the correct dashboard section

**Files:**
- Modify: `lib/wallet/admin-actions.ts`
- Modify: `lib/exchange/admin-actions.ts`
- Modify: `lib/friends/actions.ts`
- Modify: `lib/friendly-matches/admin-actions.ts`
- Modify: `app/auth/confirm/route.ts`

- [ ] **Step 1: Wallet notifications → `/dashboard#wallet`**

In `lib/wallet/admin-actions.ts`, `resolveWalletWithdrawal` (line 58) and `adminCreditWallet` (line 95):

```typescript
    link: '/dashboard#wallet',
```

(apply to both `notifyInApp` calls — `withdrawal_paid`/`withdrawal_rejected` and `wallet_credited`)

- [ ] **Step 2: Listing notifications → `/exchange`**

In `lib/exchange/admin-actions.ts`, `setStatus` (line 30), change the `link`:

```typescript
      link: '/exchange',
```

- [ ] **Step 3: Friend-request-accepted notification → `/dashboard#friends`**

In `lib/friends/actions.ts`, `acceptFriendRequest` (line 67):

```typescript
    link: '/dashboard#friends',
```

- [ ] **Step 4: Friendly-match result-confirmed notification → the specific match room**

In `lib/friendly-matches/admin-actions.ts`, `confirmFriendlyResult` (line 72), inside the `for (const playerId of [...])` loop:

```typescript
  for (const playerId of [fm.challenger_id, fm.opponent_id]) {
    await notifyInApp({
      playerId,
      type: 'result_confirmed',
      title: 'Friendly match confirmed',
      body:
        playerId === fm.winner_id
          ? 'You won your friendly match — confirmed by admin.'
          : 'Your friendly match result was confirmed by admin.',
      link: `/dashboard/friendlies/${fm.id}`,
    })
  }
```

- [ ] **Step 5: Referral-credited notification → `/dashboard#referrals`**

In `app/auth/confirm/route.ts`, `creditReferralIfAny` (line 71):

```typescript
  await notifyInApp({
    playerId: profile.referred_by,
    type: 'referral_credited',
    title: 'Referral credited',
    body: 'Someone you referred just joined Sentinel X — ₦100 added to your wallet.',
    link: '/dashboard#referrals',
  })
```

Leave `lib/matches/verify-actions.ts`'s `result_confirmed` notification (tournament matches, not friendlies) unchanged — it already links to the specific `/matches/${id}` page, which is more precise than a dashboard anchor.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add lib/wallet/admin-actions.ts lib/exchange/admin-actions.ts lib/friends/actions.ts lib/friendly-matches/admin-actions.ts app/auth/confirm/route.ts
git commit -m "fix: notifications deep-link to the specific dashboard section or match room"
```

---

### Task 9: Avatar updates propagate to the dashboard header and nav

**Files:**
- Modify: `components/dashboard/DashboardHeader.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `lib/profile/actions.ts`

- [ ] **Step 1: Make `DashboardHeader` render the actual avatar image**

`DashboardHeader.tsx` currently only ever renders an initial-letter circle it builds itself — it never received an `avatarUrl` prop at all, which is why a new photo never appears there. Rewrite it to use the shared `Avatar` component, matching `ProfileHeader`/`AccountMenu`:

```tsx
import { Avatar } from '@/components/shared/Avatar'

export function DashboardHeader({
  name,
  username,
  avatarUrl,
  wins,
  losses,
  goalsScored,
}: {
  name: string
  username: string | null
  avatarUrl: string | null
  wins: number
  losses: number
  goalsScored: number
}) {
  return (
    <div className="flex items-center gap-4 py-8">
      <Avatar avatarUrl={avatarUrl} displayName={name} username={username} size={56} className="text-xl" />
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-bold text-emerald-400">{wins}</span> W ·{' '}
          <span className="font-bold text-red-400">{losses}</span> L ·{' '}
          <span className="font-bold text-white">{goalsScored}</span> goals
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Pass `avatarUrl`/`username` from the dashboard page**

In `app/dashboard/page.tsx`, update the `<DashboardHeader />` call (lines 280–285):

```tsx
      <DashboardHeader
        name={displayName}
        username={profile?.username ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        wins={profile?.wins ?? 0}
        losses={profile?.losses ?? 0}
        goalsScored={profile?.goals_scored ?? 0}
      />
```

- [ ] **Step 3: Revalidate the root layout so the nav avatar refreshes immediately too**

In `lib/profile/actions.ts`, `updateProfile` (lines 44–45), add a layout-scope revalidation alongside the existing ones — the nav's `AccountMenu`/`BottomTabBar` avatar comes from `getNavSession()` in the root layout, which today only re-runs on auth transitions:

```typescript
  revalidatePath('/dashboard')
  revalidatePath('/players/[username]', 'page')
  revalidatePath('/', 'layout')
  return { success: true }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

Manually verify in the dev server: change your avatar in the dashboard's "Edit profile" form, save, and confirm the new photo appears in the dashboard header, the top nav, and `/players/[your-username]` without a hard reload.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/DashboardHeader.tsx app/dashboard/page.tsx lib/profile/actions.ts
git commit -m "fix: dashboard header shows the actual avatar and refreshes across nav after a photo change"
```
