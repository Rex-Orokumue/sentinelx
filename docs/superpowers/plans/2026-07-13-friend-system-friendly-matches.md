# Friend System + Friendly Matches (#26) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players can friend each other and challenge anyone to a friendly match — free (social, zero stats impact) or staked (real money via the existing Paystack flow, Sentinel-Score-only impact, its own withdrawable balance). A Match Room lets accepted-challenge players coordinate.

**Architecture:** Two new independent tables (`friends`, `friendly_matches`) plus a third (`friendly_withdrawal_requests`) that mirrors `referral_withdrawal_requests` exactly. `friendly_matches` doubles as the challenge-and-match lifecycle tracker — no separate `challenges` table. Staked payment reuses the existing Paystack inline-checkout + webhook infrastructure by extending it (not replacing it) with a fallback lookup. Sentinel Score events reuse the existing event types/point constants via a new one-time insert function — deliberately NOT the `syncMatchEvents` regeneration engine, which is tournament-match-specific.

**Tech Stack:** Next.js 14 App Router (Server Components, Server Actions), Supabase (Postgres + RLS + Storage), Paystack, TypeScript, Vitest, Tailwind.

## Global Constraints

- `friendly_matches.stake_amount` is a single shared column — both players always pay the same amount, so a completed staked match's pot is always exactly `stake_amount * 2`.
- Match Room shows a WhatsApp **button** per player (reusing `toWhatsAppNumber`/wa.me link-building from `lib/dashboard/fixtures.ts`), never the raw `profiles.whatsapp_number` as text — matches #25's established pattern.
- Sentinel Score events for staked friendlies: `match_id = null`, reuse `MATCH_COMPLETED_DELTA`/`WIN_DELTA` from `lib/scoring/events.ts` and the same `event_type` strings, via a **new one-time-insert function** — never call `syncMatchEvents` (that's `matches`-table regeneration, not applicable here).
- Free friendlies never write to `sentinel_score_events` at all.
- The Paystack webhook (`app/api/paystack/webhook/route.ts`) AND the callback route (`app/api/paystack/callback/route.ts`) both need the friendly-stake fallback — fan-out is gated strictly on `confirmRegistration` returning exactly `'not_found'`, never on catching a thrown exception.
- `/admin/friendlies` is a new financial admin queue: `adminOnly: true` in `lib/admin/nav.ts`, `requireAdmin()` in the page (moderators excluded, matching Withdrawals/Referrals).
- Migration file: `supabase/migrations/023_friends_and_friendly_matches.sql` (next after `022_player_notifications.sql`).

---

### Task 1: Migration — `friends`, `friendly_matches`, `friendly_withdrawal_requests`, storage bucket

**Files:**
- Create: `supabase/migrations/023_friends_and_friendly_matches.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- Friend system
-- =============================================================
CREATE TABLE public.friends (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid        NOT NULL REFERENCES public.profiles(id),
  recipient_id uuid        NOT NULL REFERENCES public.profiles(id),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, recipient_id)
);
CREATE INDEX ON public.friends (requester_id);
CREATE INDEX ON public.friends (recipient_id);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friends_participant_read" ON public.friends
  FOR SELECT USING (requester_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY "friends_requester_insert" ON public.friends
  FOR INSERT WITH CHECK (requester_id = auth.uid() AND status = 'pending');
-- Recipient accepts by flipping status; requester never updates their own request.
CREATE POLICY "friends_recipient_update" ON public.friends
  FOR UPDATE USING (recipient_id = auth.uid());
-- Either side can delete: requester cancels a pending request, recipient
-- declines a pending request, either side removes an accepted friendship.
CREATE POLICY "friends_participant_delete" ON public.friends
  FOR DELETE USING (requester_id = auth.uid() OR recipient_id = auth.uid());

-- =============================================================
-- Friendly matches — one table for the whole challenge -> match lifecycle
-- =============================================================
CREATE TABLE public.friendly_matches (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id                  uuid        NOT NULL REFERENCES public.profiles(id),
  opponent_id                    uuid        NOT NULL REFERENCES public.profiles(id),
  stake_amount                   integer     CHECK (stake_amount IS NULL OR stake_amount > 0),
  status                         text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                      'pending', 'declined', 'awaiting_payment', 'active',
                                      'awaiting_admin_confirmation', 'completed', 'disputed'
                                    )),
  challenger_paid                boolean     NOT NULL DEFAULT false,
  opponent_paid                  boolean     NOT NULL DEFAULT false,
  challenger_paystack_reference  text UNIQUE,
  opponent_paystack_reference    text UNIQUE,
  game_code                      text,
  score_challenger                integer,
  score_opponent                   integer,
  screenshot_url                   text,
  winner_id                        uuid        REFERENCES public.profiles(id),
  admin_note                       text,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  completed_at                     timestamptz
);
CREATE INDEX ON public.friendly_matches (challenger_id);
CREATE INDEX ON public.friendly_matches (opponent_id);
CREATE INDEX ON public.friendly_matches (status);

ALTER TABLE public.friendly_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friendly_matches_participant_or_staff_read" ON public.friendly_matches
  FOR SELECT USING (challenger_id = auth.uid() OR opponent_id = auth.uid() OR public.is_staff());
CREATE POLICY "friendly_matches_challenger_insert" ON public.friendly_matches
  FOR INSERT WITH CHECK (challenger_id = auth.uid() AND status = 'pending');
-- Opponent accepts/declines; either participant later submits a result or
-- fills in the game code while active; admin confirms/disputes. All narrower
-- than this at the Server Action layer (matches the existing codebase
-- convention of app-level state-transition guards over fine-grained RLS).
CREATE POLICY "friendly_matches_participant_or_staff_update" ON public.friendly_matches
  FOR UPDATE USING (challenger_id = auth.uid() OR opponent_id = auth.uid() OR public.is_staff());

-- =============================================================
-- Staked-match withdrawal balance — mirrors referral_withdrawal_requests
-- exactly. Flagged in the design spec: this is the THIRD near-identical
-- withdrawal table (prize, referral, now staked-friendly) — a unified
-- withdrawal system should be seriously considered before a fourth is added.
-- =============================================================
CREATE TABLE public.friendly_withdrawal_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         integer     NOT NULL CHECK (amount > 0),
  bank_name      text        NOT NULL,
  account_number text        NOT NULL,
  account_name   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'rejected', 'paid')),
  admin_note     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX ON public.friendly_withdrawal_requests (player_id);
CREATE INDEX ON public.friendly_withdrawal_requests (status);

CREATE UNIQUE INDEX friendly_withdrawal_requests_one_pending_per_player
  ON public.friendly_withdrawal_requests (player_id) WHERE status = 'pending';

ALTER TABLE public.friendly_withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fwr_own_insert" ON public.friendly_withdrawal_requests
  FOR INSERT WITH CHECK (player_id = auth.uid() AND status = 'pending');
CREATE POLICY "fwr_own_or_admin_read" ON public.friendly_withdrawal_requests
  FOR SELECT USING (player_id = auth.uid() OR public.is_admin());
CREATE POLICY "fwr_admin_update" ON public.friendly_withdrawal_requests
  FOR UPDATE USING (public.is_admin());

-- =============================================================
-- player_notifications.type CHECK extended for the two new event types
-- this feature adds (friendly_withdrawal_paid/rejected) — reusing the
-- existing withdrawal_paid/rejected values here would make the notification
-- feed unable to distinguish a prize-withdrawal notification from a
-- staked-friendly one; referral withdrawals got their own dedicated types
-- for the same reason, so this follows that precedent.
-- =============================================================
ALTER TABLE public.player_notifications DROP CONSTRAINT player_notifications_type_check;
ALTER TABLE public.player_notifications ADD CONSTRAINT player_notifications_type_check
  CHECK (type IN (
    'listing_approved', 'listing_removed',
    'withdrawal_paid', 'withdrawal_rejected',
    'referral_withdrawal_paid', 'referral_withdrawal_rejected',
    'result_confirmed', 'referral_credited',
    'friend_request',
    'friendly_withdrawal_paid', 'friendly_withdrawal_rejected'
  ));

-- =============================================================
-- Private bucket for friendly-match result screenshots — mirrors the
-- existing match-evidence bucket's policy shape exactly.
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('friendly-match-evidence', 'friendly-match-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "friendly_match_evidence_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'friendly-match-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "friendly_match_evidence_select_own_or_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'friendly-match-evidence'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_staff()
    )
  );
```

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` then `--yes`. If unreachable, fall back to `mcp__claude_ai_Supabase__apply_migration` with explicit user confirmation (show the exact SQL first). If the CLI's migration-history bookkeeping is out of sync afterward (seen repeatedly this session), repair via `supabase migration repair` or by inserting directly into `supabase_migrations.schema_migrations` via `execute_sql`.

- [ ] **Step 3: Regenerate Supabase types**

Overwrite `lib/supabase/types.ts`, preserving its existing header format.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/023_friends_and_friendly_matches.sql lib/supabase/types.ts
git commit -m "feat: #26 friends, friendly_matches, friendly_withdrawal_requests schema + storage"
```

---

### Task 2: `lib/friends/schema.ts` + `lib/friends/actions.ts` — send/accept/decline/remove

**Files:**
- Create: `lib/friends/actions.ts`

**Interfaces:**
- Produces: `sendFriendRequest`, `acceptFriendRequest`, `declineFriendRequest`, `removeFriend` (all Server Actions, `FriendActionState` type) — consumed by Task 4's UI.

- [ ] **Step 1: Write the implementation**

No unit test — Server Actions hitting the DB directly, matching this codebase's convention (`lib/withdrawals/actions.ts`, `lib/referrals/actions.ts` have none either).

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyInApp } from '@/lib/notifications/inbox'

export type FriendActionState = { error?: string; success?: boolean } | undefined

export async function sendFriendRequest(
  _prev: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const recipientId = String(formData.get('recipientId') ?? '')
  if (!recipientId) return { error: 'Missing player.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (user.id === recipientId) return { error: "You can't friend yourself." }

  const { error } = await supabase
    .from('friends')
    .insert({ requester_id: user.id, recipient_id: recipientId, status: 'pending' })
  if (error) {
    // UNIQUE(requester_id, recipient_id) — a request already exists this direction.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already sent a request to this player.' }
    }
    return { error: 'Could not send the request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

export async function acceptFriendRequest(
  _prev: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing request.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fr } = await supabase
    .from('friends')
    .select('requester_id, recipient_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fr) return { error: 'Request not found.' }
  if (fr.recipient_id !== user.id) return { error: 'Only the recipient can accept this request.' }
  if (fr.status !== 'pending') return { error: 'This request was already resolved.' }

  const { error } = await supabase.from('friends').update({ status: 'accepted' }).eq('id', id)
  if (error) return { error: 'Could not accept the request. Please try again.' }

  await notifyInApp({
    playerId: fr.requester_id,
    type: 'friend_request',
    title: 'Friend request accepted',
    body: 'Your friend request was accepted.',
    link: '/dashboard',
  })

  revalidatePath('/dashboard')
  return { success: true }
}

// Covers both "decline a pending request" and "remove an accepted friend" —
// same DELETE, same participant-or-recipient ownership check, RLS enforces
// the actual row-level permission either way.
export async function removeFriend(
  _prev: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing request.' }

  const supabase = createClient()
  const { error } = await supabase.from('friends').delete().eq('id', id)
  if (error) return { error: 'Could not remove. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/friends/actions.ts
git commit -m "feat: #26 friend request send/accept/decline/remove actions"
```

---

### Task 3: `lib/friends/list.ts` — pure "are they friends" + sorting helper (TDD)

**Files:**
- Create: `lib/friends/list.ts`
- Test: `lib/friends/list.test.ts`

**Interfaces:**
- Produces: `FriendshipRow` type, `isFriendsWith(rows, playerId, otherId): boolean`, `sortFriendsFirst(players, friendIds): T[]` — consumed by Task 5 (challenge UI) and the player-browse page.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { isFriendsWith, sortFriendsFirst, type FriendshipRow } from './list'

function row(over: Partial<FriendshipRow>): FriendshipRow {
  return { requesterId: 'a', recipientId: 'b', status: 'accepted', ...over }
}

describe('isFriendsWith', () => {
  it('is true when accepted in the requester direction', () => {
    expect(isFriendsWith([row({ requesterId: 'me', recipientId: 'you' })], 'me', 'you')).toBe(true)
  })
  it('is true when accepted in the recipient direction (order-independent)', () => {
    expect(isFriendsWith([row({ requesterId: 'you', recipientId: 'me' })], 'me', 'you')).toBe(true)
  })
  it('is false when only pending', () => {
    expect(
      isFriendsWith([row({ requesterId: 'me', recipientId: 'you', status: 'pending' })], 'me', 'you'),
    ).toBe(false)
  })
  it('is false when no row exists', () => {
    expect(isFriendsWith([], 'me', 'you')).toBe(false)
  })
})

describe('sortFriendsFirst', () => {
  it('puts friend ids ahead of non-friends, stable order within each group', () => {
    const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const r = sortFriendsFirst(players, new Set(['c']))
    expect(r.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when no friends are present', () => {
    const players = [{ id: 'a' }, { id: 'b' }]
    expect(sortFriendsFirst(players, new Set()).map((p) => p.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/friends/list.test.ts`
Expected: FAIL — `Cannot find module './list'`

- [ ] **Step 3: Write the implementation**

```typescript
export interface FriendshipRow {
  requesterId: string
  recipientId: string
  status: string
}

export function isFriendsWith(rows: FriendshipRow[], playerId: string, otherId: string): boolean {
  return rows.some(
    (r) =>
      r.status === 'accepted' &&
      ((r.requesterId === playerId && r.recipientId === otherId) ||
        (r.requesterId === otherId && r.recipientId === playerId)),
  )
}

// Stable partition: friends first (in their original relative order), then
// everyone else (in their original relative order).
export function sortFriendsFirst<T extends { id: string }>(players: T[], friendIds: Set<string>): T[] {
  const friends = players.filter((p) => friendIds.has(p.id))
  const others = players.filter((p) => !friendIds.has(p.id))
  return [...friends, ...others]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/friends/list.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/friends/list.ts lib/friends/list.test.ts
git commit -m "feat: #26 pure friend-status and friends-first sorting helpers"
```

---

### Task 4: Dashboard friend section — requests + list

**Files:**
- Create: `components/dashboard/FriendsPanel.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `sendFriendRequest`, `acceptFriendRequest`, `removeFriend` (Task 2).

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useFormState } from 'react-dom'
import {
  acceptFriendRequest,
  removeFriend,
  type FriendActionState,
} from '@/lib/friends/actions'

export interface FriendRequestRow {
  id: string
  requesterName: string
  requesterUsername: string | null
}

export interface FriendRow {
  id: string
  friendName: string
  friendUsername: string | null
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

function IncomingRequestRow({ req }: { req: FriendRequestRow }) {
  const [state, action] = useFormState<FriendActionState, FormData>(acceptFriendRequest, undefined)
  const [declineState, declineAction] = useFormState<FriendActionState, FormData>(removeFriend, undefined)
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="min-w-0 truncate text-sm font-semibold text-white">
        {req.requesterName} {req.requesterUsername ? `(@${req.requesterUsername})` : ''}
      </p>
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
      <p className="min-w-0 truncate text-sm font-semibold text-white">
        {friend.friendName} {friend.friendUsername ? `(@${friend.friendUsername})` : ''}
      </p>
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

- [ ] **Step 2: Wire into the dashboard page**

Add the import:

```typescript
import { FriendsPanel, type FriendRequestRow, type FriendRow } from '@/components/dashboard/FriendsPanel'
```

Add a parallel query alongside the existing `Promise.all([...])` array — fetch this player's `friends` rows joined to the other party's profile:

```typescript
supabase
  .from('friends')
  .select(
    'id, requester_id, recipient_id, status, ' +
      'requester:profiles!friends_requester_id_fkey(username, display_name), ' +
      'recipient:profiles!friends_recipient_id_fkey(username, display_name)',
  )
  .or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`),
```

(add a matching destructured name, e.g. `friendsRes`, to the query result array)

After the existing helper functions near the top of the file, add:

```typescript
type FriendProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function friendProfileName(p: FriendProfileRef): { name: string; username: string | null } {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return { name: r?.display_name ?? r?.username ?? 'Player', username: r?.username ?? null }
}
```

Before the JSX return, build the two lists:

```typescript
  const rawFriends = ((friendsRes.data as unknown[] | null) ?? []) as {
    id: string
    requester_id: string
    recipient_id: string
    status: string
    requester: FriendProfileRef
    recipient: FriendProfileRef
  }[]
  const incomingRequests: FriendRequestRow[] = rawFriends
    .filter((f) => f.status === 'pending' && f.recipient_id === user.id)
    .map((f) => {
      const p = friendProfileName(f.requester)
      return { id: f.id, requesterName: p.name, requesterUsername: p.username }
    })
  const friendsList: FriendRow[] = rawFriends
    .filter((f) => f.status === 'accepted')
    .map((f) => {
      const otherIsRequester = f.recipient_id === user.id
      const p = friendProfileName(otherIsRequester ? f.requester : f.recipient)
      return { id: f.id, friendName: p.name, friendUsername: p.username }
    })
```

Add to the JSX, right after `<ReferralPanel ... />`:

```tsx
<FriendsPanel incoming={incomingRequests} friends={friendsList} />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/FriendsPanel.tsx app/dashboard/page.tsx
git commit -m "feat: #26 friend requests + friends list on the dashboard"
```

---

### Task 5: "Add friend" button on the public player profile page

**Files:**
- Create: `components/player/AddFriendButton.tsx`
- Modify: `components/player/ProfileHeader.tsx`
- Modify: `app/(public)/players/[username]/page.tsx`

**Interfaces:**
- Consumes: `sendFriendRequest` (Task 2).

- [ ] **Step 1: Write the button component**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { sendFriendRequest, type FriendActionState } from '@/lib/friends/actions'

export function AddFriendButton({ recipientId }: { recipientId: string }) {
  const [state, action] = useFormState<FriendActionState, FormData>(sendFriendRequest, undefined)
  if (state?.success) {
    return <p className="text-sm text-emerald-400">Request sent.</p>
  }
  return (
    <form action={action}>
      <input type="hidden" name="recipientId" value={recipientId} />
      <button
        type="submit"
        className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-bold text-violet-400 hover:bg-violet-500/10"
      >
        Add friend
      </button>
      {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Add `id` and `viewerId` to `ProfileView`/`ProfileHeader`, render the button when it's not your own profile**

`ProfileView` (`lib/players/profile.ts`) already has `id: string` (the profile owner's id). Add a `viewerId: string | null` prop to `ProfileHeader`:

```typescript
import { AddFriendButton } from '@/components/player/AddFriendButton'
```

In `ProfileHeader`'s function signature, accept the new prop:

```typescript
export function ProfileHeader({ profile, viewerId }: { profile: ProfileView; viewerId: string | null }) {
```

In the JSX, after the bio paragraph, add:

```tsx
        {viewerId && viewerId !== profile.id && (
          <div className="mt-3">
            <AddFriendButton recipientId={profile.id} />
          </div>
        )}
```

- [ ] **Step 3: Pass the viewer's id from the page**

In `app/(public)/players/[username]/page.tsx`, fetch the current user alongside the existing profile lookup and pass it through:

```typescript
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
```

(add this near the top of `PlayerProfilePage`, before or alongside the existing `loadProfile` call — `supabase` is already in scope there)

Update the `<ProfileHeader />` call:

```tsx
<ProfileHeader profile={profile} viewerId={user?.id ?? null} />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add components/player/AddFriendButton.tsx components/player/ProfileHeader.tsx "app/(public)/players/[username]/page.tsx"
git commit -m "feat: #26 Add friend button on the public player profile"
```

---

### Task 6: `lib/friendly-matches/scoring.ts` — pure Sentinel Score event builder (TDD)

**Files:**
- Create: `lib/friendly-matches/scoring.ts`
- Test: `lib/friendly-matches/scoring.test.ts`

**Interfaces:**
- Consumes: `MATCH_COMPLETED_DELTA`, `WIN_DELTA` from `lib/scoring/events.ts`.
- Produces: `friendlyMatchEventsFor(match): NewFriendlyEvent[]` — consumed by Task 9 (admin confirm action).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { friendlyMatchEventsFor, type FriendlyMatchInput } from './scoring'

function m(over: Partial<FriendlyMatchInput>): FriendlyMatchInput {
  return {
    id: 'fm1',
    challengerId: 'a',
    opponentId: 'b',
    scoreChallenger: 3,
    scoreOpponent: 1,
    winnerId: 'a',
    ...over,
  }
}

describe('friendlyMatchEventsFor', () => {
  it('credits match_completed to both players', () => {
    const events = friendlyMatchEventsFor(m({}))
    const types = events.filter((e) => e.event_type === 'match_completed').map((e) => e.player_id)
    expect(types.sort()).toEqual(['a', 'b'])
  })

  it('credits win_no_dispute to the winner only', () => {
    const events = friendlyMatchEventsFor(m({}))
    const winEvents = events.filter((e) => e.event_type === 'win_no_dispute')
    expect(winEvents).toEqual([
      { player_id: 'a', match_id: null, event_type: 'win_no_dispute', points_delta: 1, note: 'Staked friendly match fm1' },
    ])
  })

  it('uses null match_id and a note referencing the friendly match id', () => {
    const events = friendlyMatchEventsFor(m({}))
    expect(events.every((e) => e.match_id === null)).toBe(true)
    expect(events.every((e) => e.note === 'Staked friendly match fm1')).toBe(true)
  })

  it('awards no win event when there is no winner (should not happen for a completed staked friendly, but must not crash)', () => {
    const events = friendlyMatchEventsFor(m({ winnerId: null }))
    expect(events.filter((e) => e.event_type === 'win_no_dispute')).toEqual([])
    expect(events).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/friendly-matches/scoring.test.ts`
Expected: FAIL — `Cannot find module './scoring'`

- [ ] **Step 3: Write the implementation**

```typescript
import { MATCH_COMPLETED_DELTA, WIN_DELTA } from '@/lib/scoring/events'

export interface FriendlyMatchInput {
  id: string
  challengerId: string
  opponentId: string
  scoreChallenger: number | null
  scoreOpponent: number | null
  winnerId: string | null
}

export interface NewFriendlyEvent {
  player_id: string
  match_id: null
  event_type: 'match_completed' | 'win_no_dispute'
  points_delta: number
  note: string
}

// Staked friendlies reuse the SAME event_type vocabulary and point values as
// tournament matches (lib/scoring/events.ts), for consistency — but this is a
// one-time insert, NOT the syncMatchEvents regeneration engine (that's
// matches-table-specific; a disputed staked friendly is resolved manually by
// admin, not automatically recomputed). match_id is null since these aren't
// tournament matches; the friendly match's id is recorded in `note` instead.
export function friendlyMatchEventsFor(match: FriendlyMatchInput): NewFriendlyEvent[] {
  const note = `Staked friendly match ${match.id}`
  const events: NewFriendlyEvent[] = [
    { player_id: match.challengerId, match_id: null, event_type: 'match_completed', points_delta: MATCH_COMPLETED_DELTA, note },
    { player_id: match.opponentId, match_id: null, event_type: 'match_completed', points_delta: MATCH_COMPLETED_DELTA, note },
  ]
  if (match.winnerId) {
    events.push({ player_id: match.winnerId, match_id: null, event_type: 'win_no_dispute', points_delta: WIN_DELTA, note })
  }
  return events
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/friendly-matches/scoring.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/friendly-matches/scoring.ts lib/friendly-matches/scoring.test.ts
git commit -m "feat: #26 pure Sentinel Score event builder for staked friendlies"
```

---

### Task 7: `lib/friendly-matches/actions.ts` — challenge, accept, decline

**Files:**
- Create: `lib/friendly-matches/schema.ts`
- Create: `lib/friendly-matches/actions.ts`

- [ ] **Step 1: Write the schema**

```typescript
import { z } from 'zod'

export const challengeSchema = z.object({
  opponentId: z.string().uuid(),
  stakeAmount: z.union([
    z.literal(''),
    z.coerce.number().int().min(100, 'Minimum stake is ₦100'),
  ]),
})

export type ChallengeInput = z.infer<typeof challengeSchema>
```

- [ ] **Step 2: Write the actions**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyInApp } from '@/lib/notifications/inbox'
import { challengeSchema } from './schema'

export type FriendlyActionState = { error?: string; success?: boolean; matchId?: string } | undefined

export async function sendChallenge(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const parsed = challengeSchema.safeParse({
    opponentId: formData.get('opponentId') ?? '',
    stakeAmount: formData.get('stakeAmount') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (user.id === parsed.data.opponentId) return { error: "You can't challenge yourself." }

  const stakeAmount = parsed.data.stakeAmount === '' ? null : parsed.data.stakeAmount

  const { data: created, error } = await supabase
    .from('friendly_matches')
    .insert({
      challenger_id: user.id,
      opponent_id: parsed.data.opponentId,
      stake_amount: stakeAmount,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !created) return { error: 'Could not send the challenge. Please try again.' }

  await notifyInApp({
    playerId: parsed.data.opponentId,
    type: 'friend_request', // reuses the friend_request bell type — a challenge is a social invite, same category
    title: stakeAmount ? 'Staked challenge received' : 'Friendly challenge received',
    body: stakeAmount
      ? `You've been challenged to a ₦${stakeAmount} staked friendly.`
      : "You've been challenged to a friendly match.",
    link: `/dashboard`,
  })

  revalidatePath('/dashboard')
  return { success: true, matchId: created.id }
}

export async function acceptChallenge(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('opponent_id, status, stake_amount')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (fm.opponent_id !== user.id) return { error: 'Only the challenged player can accept.' }
  if (fm.status !== 'pending') return { error: 'This challenge was already resolved.' }

  const nextStatus = fm.stake_amount ? 'awaiting_payment' : 'active'
  const { error } = await supabase
    .from('friendly_matches')
    .update({ status: nextStatus })
    .eq('id', id)
  if (error) return { error: 'Could not accept. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true, matchId: id }
}

export async function declineChallenge(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('opponent_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (fm.opponent_id !== user.id) return { error: 'Only the challenged player can decline.' }
  if (fm.status !== 'pending') return { error: 'This challenge was already resolved.' }

  const { error } = await supabase.from('friendly_matches').update({ status: 'declined' }).eq('id', id)
  if (error) return { error: 'Could not decline. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing these files

- [ ] **Step 4: Commit**

```bash
git add lib/friendly-matches/schema.ts lib/friendly-matches/actions.ts
git commit -m "feat: #26 challenge send/accept/decline actions"
```

---

### Task 8: Staked payment — Paystack initiate + webhook/callback fan-out

**Files:**
- Modify: `lib/paystack/server.ts`
- Create: `lib/friendly-matches/confirm.ts`
- Create: `lib/friendly-matches/pay-actions.ts`
- Modify: `app/api/paystack/webhook/route.ts`
- Modify: `app/api/paystack/callback/route.ts`

**Interfaces:**
- Consumes: `initializeTransaction`, `verifyTransaction` (`lib/paystack/server.ts`), `confirmRegistration` (`lib/tournaments/confirm.ts`).
- Produces: `buildFriendlyStakeReference`, `confirmFriendlyStake(reference): Promise<ConfirmResult>`, `payStake` Server Action.

- [ ] **Step 1: Add the reference builder**

In `lib/paystack/server.ts`, add alongside `buildReference`:

```typescript
export function buildFriendlyStakeReference(friendlyMatchId: string, userId: string): string {
  const m = friendlyMatchId.replace(/-/g, '').slice(0, 8)
  const u = userId.replace(/-/g, '').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sxfm_${m}_${u}_${rand}`
}
```

- [ ] **Step 2: Write `confirmFriendlyStake`**

Mirrors `lib/tournaments/confirm.ts`'s `confirmRegistration` shape exactly, but the "expected amount" comes from the row (`stake_amount`) rather than a constant, and it must figure out which side (`challenger`/`opponent`) the reference belongs to.

```typescript
import { verifyTransaction } from '@/lib/paystack/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { friendlyMatchEventsFor } from './scoring'

export type FriendlyConfirmResult = 'confirmed' | 'already_paid' | 'not_found' | 'not_successful'

export function decideFriendlyConfirmation(args: {
  alreadyPaid: boolean
  stakeAmount: number | null
  verify: { status: string; amountKobo: number } | null
}): FriendlyConfirmResult {
  if (args.alreadyPaid) return 'already_paid'
  if (!args.stakeAmount) return 'not_found'
  if (!args.verify) return 'not_successful'
  if (args.verify.status !== 'success') return 'not_successful'
  if (args.verify.amountKobo < args.stakeAmount * 100) return 'not_successful'
  return 'confirmed'
}

// Idempotent source of truth, called by BOTH the callback and the webhook —
// same pattern as confirmRegistration. Returns 'not_found' (never throws)
// when the reference matches neither side of any friendly match, which is
// what lets the Paystack webhook/callback safely try this AFTER
// confirmRegistration returns 'not_found' for a tournament-registration
// lookup, without risking a real error being silently reinterpreted.
export async function confirmFriendlyStake(reference: string): Promise<FriendlyConfirmResult> {
  const db = createAdminClient()

  const { data: byChallenger } = await db
    .from('friendly_matches')
    .select('id, challenger_id, opponent_id, stake_amount, challenger_paid, opponent_paid, status')
    .eq('challenger_paystack_reference', reference)
    .maybeSingle()
  const { data: byOpponent } = byChallenger
    ? { data: null }
    : await db
        .from('friendly_matches')
        .select('id, challenger_id, opponent_id, stake_amount, challenger_paid, opponent_paid, status')
        .eq('opponent_paystack_reference', reference)
        .maybeSingle()

  const match = byChallenger ?? byOpponent
  if (!match) return 'not_found'
  const side: 'challenger' | 'opponent' = byChallenger ? 'challenger' : 'opponent'
  const alreadyPaid = side === 'challenger' ? match.challenger_paid : match.opponent_paid

  let verify: { status: string; amountKobo: number } | null = null
  try {
    verify = await verifyTransaction(reference)
  } catch (err) {
    console.error('[confirmFriendlyStake] Paystack verify failed', {
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    verify = null
  }

  const decision = decideFriendlyConfirmation({ alreadyPaid, stakeAmount: match.stake_amount, verify })
  if (decision !== 'confirmed') return decision

  const paidField = side === 'challenger' ? 'challenger_paid' : 'opponent_paid'
  const otherPaid = side === 'challenger' ? match.opponent_paid : match.challenger_paid
  await db
    .from('friendly_matches')
    .update({
      [paidField]: true,
      // Both sides paid -> unlock the Match Room. Otherwise stay awaiting_payment.
      status: otherPaid ? 'active' : 'awaiting_payment',
    })
    .eq('id', match.id)

  return 'confirmed'
}
```

- [ ] **Step 3: Write the `payStake` Server Action**

```typescript
'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { initializeTransaction, buildFriendlyStakeReference } from '@/lib/paystack/server'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

export type PayStakeState = { error?: string } | undefined

export async function payStake(_prev: PayStakeState, formData: FormData): Promise<PayStakeState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, stake_amount, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this challenge can pay.' }
  }
  if (fm.status !== 'awaiting_payment') return { error: 'This challenge is not awaiting payment.' }
  if (!fm.stake_amount) return { error: 'This is a free friendly — no payment needed.' }

  const isChallenger = user.id === fm.challenger_id
  const reference = buildFriendlyStakeReference(id, user.id)
  const refField = isChallenger ? 'challenger_paystack_reference' : 'opponent_paystack_reference'
  await supabase.from('friendly_matches').update({ [refField]: reference }).eq('id', id)

  let authorizationUrl: string
  try {
    authorizationUrl = await initializeTransaction({
      email: user.email!,
      amountKobo: fm.stake_amount * 100,
      reference,
      callbackUrl: `${SITE_URL}/api/paystack/callback`,
      metadata: { friendly_match_id: id, player_id: user.id },
    })
  } catch (err) {
    console.error('[payStake] Paystack initialize failed', {
      id,
      reference,
      message: err instanceof Error ? err.message : String(err),
    })
    return { error: 'Payment could not be started. Please try again.' }
  }

  redirect(authorizationUrl)
}
```

- [ ] **Step 4: Wire the webhook fan-out**

In `app/api/paystack/webhook/route.ts`:

```typescript
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
```

Change the `charge.success` branch:

```typescript
  if (type === 'charge.success' && event.data?.reference) {
    const result = await confirmRegistration(event.data.reference)
    // Fan-out is gated strictly on this exact return value — never on
    // catching an exception. confirmRegistration doesn't throw in practice
    // (every path resolves to a ConfirmResult string); if that ever changes,
    // a genuine error must still propagate as a 500, not fall through here.
    if (result === 'not_found') {
      await confirmFriendlyStake(event.data.reference)
    }
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
```

(the rest of the `else if` chain is unchanged)

- [ ] **Step 5: Wire the callback fan-out**

In `app/api/paystack/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get('reference')
  const origin = req.nextUrl.origin
  if (!reference) {
    return NextResponse.redirect(new URL('/tournaments', origin))
  }

  const result = await confirmRegistration(reference)
  if (result !== 'not_found') {
    const db = createAdminClient()
    const { data } = await db
      .from('tournament_registrations')
      .select('tournaments(slug)')
      .eq('paystack_reference', reference)
      .maybeSingle()
    const slug = (data?.tournaments as { slug: string } | null)?.slug
    const success = result === 'confirmed' || result === 'already_paid'
    const dest = slug ? `/tournaments/${slug}?${success ? 'paid=1' : 'payment=failed'}` : '/tournaments'
    return NextResponse.redirect(new URL(dest, origin))
  }

  // Not a tournament registration reference — try a friendly-match stake.
  const friendlyResult = await confirmFriendlyStake(reference)
  const db = createAdminClient()
  const { data: byChallenger } = await db
    .from('friendly_matches')
    .select('id')
    .eq('challenger_paystack_reference', reference)
    .maybeSingle()
  const { data: byOpponent } = byChallenger
    ? { data: null }
    : await db
        .from('friendly_matches')
        .select('id')
        .eq('opponent_paystack_reference', reference)
        .maybeSingle()
  const matchId = byChallenger?.id ?? byOpponent?.id
  const success = friendlyResult === 'confirmed' || friendlyResult === 'already_paid'
  const dest = matchId
    ? `/dashboard/friendlies/${matchId}?${success ? 'paid=1' : 'payment=failed'}`
    : '/dashboard'
  return NextResponse.redirect(new URL(dest, origin))
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add lib/paystack/server.ts lib/friendly-matches/confirm.ts lib/friendly-matches/pay-actions.ts app/api/paystack/webhook/route.ts app/api/paystack/callback/route.ts
git commit -m "feat: #26 staked friendly payment — Paystack initiate + webhook/callback fan-out"
```

---

### Task 9: Result submission + admin confirm/dispute (Sentinel Score + staked balance credit)

**Files:**
- Create: `lib/friendly-matches/result-schema.ts`
- Create: `lib/friendly-matches/result-actions.ts`
- Create: `lib/friendly-matches/admin-actions.ts`

- [ ] **Step 1: Write the result schema**

```typescript
import { z } from 'zod'

export const friendlyResultSchema = z.object({
  scoreChallenger: z.coerce.number().int().min(0),
  scoreOpponent: z.coerce.number().int().min(0),
})

export type FriendlyResultInput = z.infer<typeof friendlyResultSchema>
```

- [ ] **Step 2: Write `submitFriendlyResult`**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { friendlyResultSchema } from './result-schema'
import type { FriendlyActionState } from './actions'

export async function submitFriendlyResult(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  const screenshotUrl = String(formData.get('screenshotUrl') ?? '')
  if (!id) return { error: 'Missing match.' }
  if (!screenshotUrl) return { error: 'A screenshot is required.' }

  const parsed = friendlyResultSchema.safeParse({
    scoreChallenger: formData.get('scoreChallenger'),
    scoreOpponent: formData.get('scoreOpponent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  if (parsed.data.scoreChallenger === parsed.data.scoreOpponent) {
    return { error: 'A friendly match cannot end in a draw.' }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('challenger_id, opponent_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (user.id !== fm.challenger_id && user.id !== fm.opponent_id) {
    return { error: 'Only the two players in this match can submit a result.' }
  }
  if (fm.status !== 'active') return { error: 'This match is not active.' }

  const winnerId =
    parsed.data.scoreChallenger > parsed.data.scoreOpponent ? fm.challenger_id : fm.opponent_id

  const { error } = await supabase
    .from('friendly_matches')
    .update({
      score_challenger: parsed.data.scoreChallenger,
      score_opponent: parsed.data.scoreOpponent,
      screenshot_url: screenshotUrl,
      winner_id: winnerId,
      status: 'awaiting_admin_confirmation',
    })
    .eq('id', id)
  if (error) return { error: 'Could not submit your result. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 3: Write the admin confirm/dispute actions**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { friendlyMatchEventsFor } from './scoring'
import { computeScore } from '@/lib/scoring/score'

export type FriendlyAdminState = { error?: string; success?: boolean } | undefined

export async function confirmFriendlyResult(
  _prev: FriendlyAdminState,
  formData: FormData,
): Promise<FriendlyAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const admin = createAdminClient()
  const { data: fm } = await admin
    .from('friendly_matches')
    .select('id, challenger_id, opponent_id, stake_amount, score_challenger, score_opponent, winner_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Match not found.' }
  if (fm.status !== 'awaiting_admin_confirmation') return { error: 'This match is not awaiting confirmation.' }

  const { error } = await admin
    .from('friendly_matches')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Could not confirm the result. Please try again.' }

  // Staked friendlies only — Sentinel Score events + balance eligibility.
  // Free friendlies never reach here with a stake_amount, so this whole
  // block is a no-op for them by construction.
  if (fm.stake_amount && fm.winner_id) {
    const events = friendlyMatchEventsFor({
      id: fm.id,
      challengerId: fm.challenger_id,
      opponentId: fm.opponent_id,
      scoreChallenger: fm.score_challenger,
      scoreOpponent: fm.score_opponent,
      winnerId: fm.winner_id,
    })
    await admin.from('sentinel_score_events').insert(events)

    for (const playerId of [fm.challenger_id, fm.opponent_id]) {
      const { data: scoreEvents } = await admin
        .from('sentinel_score_events')
        .select('points_delta')
        .eq('player_id', playerId)
      await admin
        .from('profiles')
        .update({ sentinel_score: computeScore(scoreEvents ?? []) })
        .eq('id', playerId)
    }
  }

  for (const playerId of [fm.challenger_id, fm.opponent_id]) {
    await notifyInApp({
      playerId,
      type: 'result_confirmed',
      title: 'Friendly match confirmed',
      body:
        playerId === fm.winner_id
          ? 'You won your friendly match — confirmed by admin.'
          : 'Your friendly match result was confirmed by admin.',
      link: '/dashboard',
    })
  }

  revalidatePath('/admin/friendlies')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function disputeFriendlyResult(
  _prev: FriendlyAdminState,
  formData: FormData,
): Promise<FriendlyAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing match.' }
  if (!note) return { error: 'Enter a reason for the dispute.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('friendly_matches')
    .update({ status: 'disputed', admin_note: note })
    .eq('id', id)
  if (error) return { error: 'Could not save the dispute.' }

  revalidatePath('/admin/friendlies')
  return { success: true }
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add lib/friendly-matches/result-schema.ts lib/friendly-matches/result-actions.ts lib/friendly-matches/admin-actions.ts
git commit -m "feat: #26 friendly result submission + admin confirm/dispute (Sentinel Score wired)"
```

---

### Task 10: Match Room page

**Files:**
- Create: `app/dashboard/friendlies/[id]/page.tsx`
- Create: `components/friendly/MatchRoom.tsx`

**Interfaces:**
- Consumes: `payStake` (Task 8), `submitFriendlyResult` (Task 9), `toWhatsAppNumber` (`lib/dashboard/fixtures.ts`).

- [ ] **Step 1: Write the page**

```tsx
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MatchRoom } from '@/components/friendly/MatchRoom'
import { toWhatsAppNumber } from '@/lib/dashboard/fixtures'

export const metadata: Metadata = { title: 'Match Room · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null; whatsapp_number: string | null } | { username: string | null; display_name: string | null; whatsapp_number: string | null }[] | null
function first(p: ProfileRef) {
  return Array.isArray(p) ? p[0] ?? null : p
}
function nameOf(p: ReturnType<typeof first>): string {
  return p?.display_name ?? p?.username ?? 'Player'
}

export default async function MatchRoomPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/dashboard/friendlies/${params.id}`)

  const { data } = await supabase
    .from('friendly_matches')
    .select(
      'id, challenger_id, opponent_id, stake_amount, status, challenger_paid, opponent_paid, ' +
        'game_code, score_challenger, score_opponent, winner_id, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name, whatsapp_number), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name, whatsapp_number)',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (!data) notFound()
  if (user.id !== data.challenger_id && user.id !== data.opponent_id) notFound()

  const isChallenger = user.id === data.challenger_id
  const me = isChallenger ? first(data.challenger as ProfileRef) : first(data.opponent as ProfileRef)
  const opponent = isChallenger ? first(data.opponent as ProfileRef) : first(data.challenger as ProfileRef)
  const opponentWhatsappUrl = (() => {
    const num = opponent?.whatsapp_number ? toWhatsAppNumber(opponent.whatsapp_number) : null
    if (!num) return null
    return `https://wa.me/${num}?text=${encodeURIComponent("Hey! Let's coordinate our friendly match on Sentinel X")}`
  })()

  return (
    <div className="mx-auto max-w-lg px-4 pb-20 pt-6">
      <h1 className="mb-1 text-xl font-black text-white">Match Room</h1>
      <p className="mb-6 text-sm text-slate-400">
        {nameOf(me)} vs {nameOf(opponent)}
        {data.stake_amount ? ` · ₦${data.stake_amount} stake` : ' · Free friendly'}
      </p>
      <MatchRoom
        matchId={data.id}
        status={data.status}
        stakeAmount={data.stake_amount}
        isChallenger={isChallenger}
        challengerPaid={data.challenger_paid}
        opponentPaid={data.opponent_paid}
        gameCode={data.game_code}
        opponentWhatsappUrl={opponentWhatsappUrl}
        scoreChallenger={data.score_challenger}
        scoreOpponent={data.score_opponent}
      />
    </div>
  )
}
```

- [ ] **Step 2: Write the client component**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { payStake, type PayStakeState } from '@/lib/friendly-matches/pay-actions'
import { submitFriendlyResult } from '@/lib/friendly-matches/result-actions'
import type { FriendlyActionState } from '@/lib/friendly-matches/actions'
import { createClient } from '@/lib/supabase/client'

export function MatchRoom({
  matchId,
  status,
  stakeAmount,
  isChallenger,
  challengerPaid,
  opponentPaid,
  gameCode,
  opponentWhatsappUrl,
  scoreChallenger,
  scoreOpponent,
}: {
  matchId: string
  status: string
  stakeAmount: number | null
  isChallenger: boolean
  challengerPaid: boolean
  opponentPaid: boolean
  gameCode: string | null
  opponentWhatsappUrl: string | null
  scoreChallenger: number | null
  scoreOpponent: number | null
}) {
  const myPaid = isChallenger ? challengerPaid : opponentPaid
  const [payState, payAction] = useFormState<PayStakeState, FormData>(payStake, undefined)

  if (status === 'awaiting_payment') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
        <p className="mb-3 text-sm text-slate-300">
          Both players must pay ₦{stakeAmount} to unlock the Match Room.
        </p>
        {myPaid ? (
          <p className="text-sm font-semibold text-emerald-400">You've paid — waiting on your opponent.</p>
        ) : (
          <form action={payAction}>
            <input type="hidden" name="id" value={matchId} />
            <button type="submit" className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
              Pay ₦{stakeAmount}
            </button>
            {payState?.error && <p className="mt-2 text-xs text-red-400">{payState.error}</p>}
          </form>
        )}
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          {opponentWhatsappUrl ? (
            <a
              href={opponentWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] hover:bg-[#25D366]/10"
            >
              Coordinate on WhatsApp
            </a>
          ) : (
            <p className="text-xs text-slate-500">Your opponent hasn't added a WhatsApp number yet.</p>
          )}
          <GameCodeField matchId={matchId} isChallenger={isChallenger} initialCode={gameCode} />
        </div>
        <ResultForm matchId={matchId} />
      </div>
    )
  }

  if (status === 'awaiting_admin_confirmation') {
    return (
      <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm text-amber-300">
        Result submitted — waiting on admin confirmation.
      </p>
    )
  }

  if (status === 'completed') {
    return (
      <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm text-emerald-300">
        Match confirmed: {scoreChallenger}–{scoreOpponent}.
      </p>
    )
  }

  return <p className="text-sm text-slate-500">This match is {status}.</p>
}

function GameCodeField({
  matchId,
  isChallenger,
  initialCode,
}: {
  matchId: string
  isChallenger: boolean
  initialCode: string | null
}) {
  const [code, setCode] = useState(initialCode ?? '')
  const [saving, setSaving] = useState(false)

  if (!isChallenger) {
    return (
      <p className="mt-3 text-sm text-slate-300">
        Game code: <span className="font-bold text-white">{code || 'not set yet'}</span>
      </p>
    )
  }

  async function save() {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('friendly_matches').update({ game_code: code }).eq('id', matchId)
    setSaving(false)
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Drop your in-game code"
        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        Save
      </button>
    </div>
  )
}

function ResultForm({ matchId }: { matchId: string }) {
  const [state, action] = useFormState<FriendlyActionState, FormData>(submitFriendlyResult, undefined)
  const [uploading, setUploading] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState('')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      return
    }
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('friendly-match-evidence').upload(path, file)
    if (!error) {
      const { data } = supabase.storage.from('friendly-match-evidence').getPublicUrl(path)
      setScreenshotUrl(data.publicUrl)
    }
    setUploading(false)
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={matchId} />
      <input type="hidden" name="screenshotUrl" value={screenshotUrl} />
      <p className="text-sm font-bold text-white">Submit the result</p>
      <div className="flex gap-3">
        <input name="scoreChallenger" type="number" min={0} placeholder="Your score" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
        <input name="scoreOpponent" type="number" min={0} placeholder="Opponent score" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>
      <input type="file" accept="image/*" onChange={onFile} className="text-xs text-slate-400" />
      {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={uploading || !screenshotUrl}
        className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        Submit result
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add "app/dashboard/friendlies/[id]/page.tsx" components/friendly/MatchRoom.tsx
git commit -m "feat: #26 Match Room — payment, WhatsApp button, game code, result submission"
```

---

### Task 11: Admin `/admin/friendlies` queue + nav entry

**Files:**
- Create: `app/admin/friendlies/page.tsx`
- Create: `components/admin/FriendlyQueueRow.tsx`
- Modify: `lib/admin/nav.ts`

- [ ] **Step 1: Write the row component**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { confirmFriendlyResult, disputeFriendlyResult, type FriendlyAdminState } from '@/lib/friendly-matches/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingFriendlyMatch {
  id: string
  challengerName: string
  opponentName: string
  stakeAmount: number | null
  scoreChallenger: number | null
  scoreOpponent: number | null
  screenshotUrl: string | null
}

export function FriendlyQueueRow({ req }: { req: PendingFriendlyMatch }) {
  const [confirmState, confirmAction] = useFormState<FriendlyAdminState, FormData>(confirmFriendlyResult, undefined)
  const [disputeState, disputeAction] = useFormState<FriendlyAdminState, FormData>(disputeFriendlyResult, undefined)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">
          {req.challengerName} <span className="text-slate-500">vs</span> {req.opponentName}
        </p>
        {req.stakeAmount && <p className="shrink-0 text-sm font-semibold text-violet-400">{formatNaira(req.stakeAmount)} stake</p>}
      </div>
      <p className="mt-1 text-sm text-slate-300">
        Score: {req.scoreChallenger} – {req.scoreOpponent}
      </p>
      {req.screenshotUrl && (
        <a href={req.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-violet-400 hover:text-violet-300">
          View screenshot
        </a>
      )}
      <form action={disputeAction} className="mt-3">
        <input type="hidden" name="id" value={req.id} />
        <textarea
          name="note"
          rows={2}
          placeholder="Dispute reason (required to dispute)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <div className="mt-2 flex gap-2">
          <FormActionButton formAction={confirmAction} hiddenId={req.id} label="Confirm" className="bg-emerald-600 hover:bg-emerald-500" />
          <button type="submit" className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10">
            Dispute
          </button>
        </div>
      </form>
      {(confirmState?.error || disputeState?.error) && (
        <p className="mt-2 text-sm text-red-400">{confirmState?.error || disputeState?.error}</p>
      )}
    </div>
  )
}

function FormActionButton({
  formAction,
  hiddenId,
  label,
  className,
}: {
  formAction: (formData: FormData) => void
  hiddenId: string
  label: string
  className: string
}) {
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={hiddenId} />
      <button type="submit" className={`rounded-lg px-4 py-2 text-xs font-bold text-white ${className}`}>
        {label}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Write the page**

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { FriendlyQueueRow, type PendingFriendlyMatch } from '@/components/admin/FriendlyQueueRow'

export const metadata: Metadata = { title: 'Friendlies · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function nameOf(p: ProfileRef): string {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return r?.display_name ?? r?.username ?? 'Player'
}

export default async function AdminFriendliesPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('friendly_matches')
    .select(
      'id, stake_amount, score_challenger, score_opponent, screenshot_url, ' +
        'challenger:profiles!friendly_matches_challenger_id_fkey(username, display_name), ' +
        'opponent:profiles!friendly_matches_opponent_id_fkey(username, display_name)',
    )
    .eq('status', 'awaiting_admin_confirmation')
    .order('created_at', { ascending: true })

  const queue: PendingFriendlyMatch[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      stake_amount: number | null
      score_challenger: number | null
      score_opponent: number | null
      screenshot_url: string | null
      challenger: ProfileRef
      opponent: ProfileRef
    }
    return {
      id: m.id,
      challengerName: nameOf(m.challenger),
      opponentName: nameOf(m.opponent),
      stakeAmount: m.stake_amount,
      scoreChallenger: m.score_challenger,
      scoreOpponent: m.score_opponent,
      screenshotUrl: m.screenshot_url,
    }
  })

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Friendlies — awaiting confirmation</h2>
      {queue.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          Nothing awaiting confirmation.
        </p>
      ) : (
        <div className="space-y-2">
          {queue.map((req) => (
            <FriendlyQueueRow key={req.id} req={req} />
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Add the nav entry**

In `lib/admin/nav.ts`:

```typescript
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Overview', href: '/admin', adminOnly: false },
  { label: 'Tournaments', href: '/admin/tournaments', adminOnly: false },
  { label: 'Results', href: '/admin/results', adminOnly: false },
  { label: 'Community', href: '/admin/community', adminOnly: false },
  { label: 'TV', href: '/admin/tv', adminOnly: false },
  { label: 'Exchange', href: '/admin/exchange', adminOnly: false },
  { label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true },
  { label: 'Referrals', href: '/admin/referrals', adminOnly: true },
  { label: 'Friendlies', href: '/admin/friendlies', adminOnly: true },
]
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add "app/admin/friendlies/page.tsx" components/admin/FriendlyQueueRow.tsx lib/admin/nav.ts
git commit -m "feat: #26 admin friendlies confirm/dispute queue + nav entry"
```

---

### Task 12: Staked balance + withdrawal — mirrors referrals exactly

**Files:**
- Create: `lib/friendly-withdrawals/balance.ts`
- Test: `lib/friendly-withdrawals/balance.test.ts`
- Create: `lib/friendly-withdrawals/schema.ts`
- Create: `lib/friendly-withdrawals/actions.ts`
- Create: `lib/friendly-withdrawals/admin-actions.ts`
- Create: `components/dashboard/FriendlyWithdrawalPanel.tsx`
- Modify: `app/dashboard/page.tsx`
- Create: `app/admin/friendly-withdrawals/page.tsx`
- Create: `components/admin/FriendlyWithdrawalQueueRow.tsx`
- Modify: `lib/admin/nav.ts`

**Interfaces:**
- Produces: `computeStakedBalance(wins, withdrawals): number`, mirrors `lib/referrals/balance.ts`'s `computeReferralBalance` exactly but the "earned" side comes from summed match pots (`stake_amount * 2` per completed win), not a flat per-referral amount.

- [ ] **Step 0: Extend `NotificationType` in the already-shipped `lib/notifications/inbox.ts`**

Add the two new type strings this task's admin action calls `notifyInApp` with — the `type` CHECK constraint in Task 1 already includes them at the DB level, but the TypeScript union in `lib/notifications/inbox.ts` needs to match or `resolveFriendlyWithdrawal` (Step 5) won't typecheck:

```typescript
export type NotificationType =
  | 'listing_approved'
  | 'listing_removed'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'referral_withdrawal_paid'
  | 'referral_withdrawal_rejected'
  | 'result_confirmed'
  | 'referral_credited'
  | 'friend_request'
  | 'friendly_withdrawal_paid'
  | 'friendly_withdrawal_rejected'
```

(this replaces the existing 9-member union with an 11-member one — same file, same export name, no other change)

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { computeStakedBalance } from './balance'

describe('computeStakedBalance', () => {
  it('is zero with no wins', () => {
    expect(computeStakedBalance([], [])).toBe(0)
  })

  it('sums stake_amount * 2 across wins', () => {
    expect(computeStakedBalance([{ stakeAmount: 500 }, { stakeAmount: 1000 }], [])).toBe(3000)
  })

  it('subtracts pending and paid withdrawals', () => {
    expect(computeStakedBalance([{ stakeAmount: 500 }], [{ status: 'pending', amount: 400 }])).toBe(600)
  })

  it('does not subtract rejected withdrawals', () => {
    expect(computeStakedBalance([{ stakeAmount: 500 }], [{ status: 'rejected', amount: 1000 }])).toBe(1000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/friendly-withdrawals/balance.test.ts`
Expected: FAIL — `Cannot find module './balance'`

- [ ] **Step 3: Write the implementation**

```typescript
export function computeStakedBalance(
  wins: { stakeAmount: number }[],
  withdrawals: { status: string; amount: number }[],
): number {
  const earned = wins.reduce((sum, w) => sum + w.stakeAmount * 2, 0)
  const reserved = withdrawals
    .filter((w) => w.status === 'pending' || w.status === 'paid')
    .reduce((sum, w) => sum + w.amount, 0)
  return earned - reserved
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/friendly-withdrawals/balance.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the schema, actions, admin-actions**

`lib/friendly-withdrawals/schema.ts`:

```typescript
import { z } from 'zod'

export const friendlyWithdrawalSchema = z.object({
  amount: z.coerce.number().int().min(100, 'Minimum withdrawal is ₦100'),
})

export type FriendlyWithdrawalInput = z.infer<typeof friendlyWithdrawalSchema>
```

`lib/friendly-withdrawals/actions.ts` (mirrors `lib/referrals/actions.ts`'s `requestReferralWithdrawal` exactly, swapping the balance source):

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { friendlyWithdrawalSchema } from './schema'
import { computeStakedBalance } from './balance'

export type FriendlyWithdrawalState = { error?: string; success?: boolean } | undefined

export async function requestFriendlyWithdrawal(
  _prev: FriendlyWithdrawalState,
  formData: FormData,
): Promise<FriendlyWithdrawalState> {
  const parsed = friendlyWithdrawalSchema.safeParse({ amount: formData.get('amount') })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to request a withdrawal.' }

  const { data: kyc } = await supabase
    .from('player_kyc')
    .select('kyc_status, payout_bank_name, payout_account_number, payout_account_name')
    .eq('player_id', user.id)
    .maybeSingle()
  if (
    kyc?.kyc_status !== 'verified' ||
    !kyc.payout_bank_name ||
    !kyc.payout_account_number ||
    !kyc.payout_account_name
  ) {
    return { error: 'Verify your identity before requesting a withdrawal.' }
  }

  const [{ data: wins }, { data: existingRequests }] = await Promise.all([
    supabase.from('friendly_matches').select('stake_amount').eq('winner_id', user.id).eq('status', 'completed').not('stake_amount', 'is', null),
    supabase.from('friendly_withdrawal_requests').select('status, amount').eq('player_id', user.id),
  ])

  const balance = computeStakedBalance(
    (wins ?? []).map((w) => ({ stakeAmount: w.stake_amount as number })),
    existingRequests ?? [],
  )
  if (parsed.data.amount > balance) {
    return { error: 'That amount is more than your available staked-match balance.' }
  }

  const { error } = await supabase.from('friendly_withdrawal_requests').insert({
    player_id: user.id,
    amount: parsed.data.amount,
    bank_name: kyc.payout_bank_name,
    account_number: kyc.payout_account_number,
    account_name: kyc.payout_account_name,
    status: 'pending',
  })
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending staked-match withdrawal request.' }
    }
    return { error: 'Could not submit your request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}
```

`lib/friendly-withdrawals/admin-actions.ts` (mirrors `lib/referrals/admin-actions.ts`'s `resolveReferralWithdrawal` exactly, including its manual-flow-with-upgrade-note comment, and its `notifyInApp` call):

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'

export type FriendlyWithdrawalResolveState = { error?: string; success?: boolean } | undefined

// Manual flow, matching prize/referral withdrawals' current state — no
// Paystack call. When Paystack Transfer is re-enabled for prize withdrawals,
// this flow should be upgraded the same way at the same time.
export async function resolveFriendlyWithdrawal(
  _prev: FriendlyWithdrawalResolveState,
  formData: FormData,
): Promise<FriendlyWithdrawalResolveState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const action = String(formData.get('action') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { error: 'Missing request.' }
  if (action !== 'paid' && action !== 'rejected') return { error: 'Choose paid or rejected.' }
  if (action === 'rejected' && !note) return { error: 'Enter a reason for the rejection.' }

  const supabase = createClient()
  const { data: wr } = await supabase
    .from('friendly_withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await supabase
    .from('friendly_withdrawal_requests')
    .update({
      status: action === 'paid' ? 'paid' : 'rejected',
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  await notifyInApp({
    playerId: wr.player_id,
    type: action === 'paid' ? 'friendly_withdrawal_paid' : 'friendly_withdrawal_rejected',
    title: action === 'paid' ? 'Staked winnings paid' : 'Staked withdrawal rejected',
    body:
      action === 'paid'
        ? `Your staked-match withdrawal of ${formatNaira(wr.amount)} has been paid.`
        : note
          ? `Your staked-match withdrawal was rejected: ${note}`
          : 'Your staked-match withdrawal was rejected.',
    link: '/dashboard',
  })

  revalidatePath('/admin/friendly-withdrawals')
  revalidatePath('/dashboard')
  return { success: true }
}
```

- [ ] **Step 6: Write `FriendlyWithdrawalPanel.tsx`**

```tsx
'use client'
import { useFormState } from 'react-dom'
import { requestFriendlyWithdrawal, type FriendlyWithdrawalState } from '@/lib/friendly-withdrawals/actions'
import { computeStakedBalance } from '@/lib/friendly-withdrawals/balance'
import { formatDate, formatNaira } from '@/lib/format'
import { Field } from './FormField'

export interface FriendlyWithdrawalRow {
  id: string
  amount: number
  status: string
  admin_note: string | null
  requested_at: string
  resolved_at: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'text-amber-400' },
  paid: { label: 'Paid', cls: 'text-emerald-400' },
  rejected: { label: 'Rejected', cls: 'text-red-400' },
}

export function FriendlyWithdrawalPanel({
  wins,
  requests,
  kycVerified,
}: {
  wins: { stakeAmount: number }[]
  requests: FriendlyWithdrawalRow[]
  kycVerified: boolean
}) {
  const balance = computeStakedBalance(wins, requests)
  const hasActive = requests.some((r) => r.status === 'pending')

  if (wins.length === 0 && requests.length === 0) return null

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Staked match winnings</h2>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-sm text-slate-300">Balance: {formatNaira(balance)}</p>

        {!kycVerified && (
          <p className="mt-4 text-xs text-amber-400">Complete identity verification above to withdraw.</p>
        )}

        {kycVerified && hasActive && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-xs font-semibold text-amber-300">
            Request pending — we&apos;ll be in touch once it&apos;s reviewed.
          </p>
        )}

        {kycVerified && !hasActive && balance > 0 && <RequestForm maxAmount={balance} />}
      </div>

      {requests.length > 0 && (
        <div className="mt-2 space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function RequestForm({ maxAmount }: { maxAmount: number }) {
  const [state, formAction] = useFormState<FriendlyWithdrawalState, FormData>(
    requestFriendlyWithdrawal,
    undefined,
  )
  return (
    <form action={formAction} className="mt-4 space-y-3">
      <Field
        name="amount"
        label={`Amount (₦, up to ${formatNaira(maxAmount)})`}
        type="number"
        min={100}
        max={maxAmount}
        placeholder="100"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500"
      >
        Request withdrawal
      </button>
    </form>
  )
}

function RequestRow({ req }: { req: FriendlyWithdrawalRow }) {
  const s = STATUS[req.status] ?? { label: req.status, cls: 'text-slate-400' }
  const when = formatDate(req.resolved_at ?? req.requested_at) ?? ''
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">{formatNaira(req.amount)}</p>
        <span className={`text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{when}</p>
      {req.admin_note && <p className="mt-1 text-xs text-slate-400">Note: {req.admin_note}</p>}
    </div>
  )
}
```

- [ ] **Step 7: Wire into `app/dashboard/page.tsx`**

Add the import:

```typescript
import { FriendlyWithdrawalPanel, type FriendlyWithdrawalRow } from '@/components/dashboard/FriendlyWithdrawalPanel'
```

Add two more parallel queries to the existing `Promise.all([...])` array (with matching destructured names, e.g. `friendlyWinsRes, friendlyWithdrawalsRes`):

```typescript
supabase
  .from('friendly_matches')
  .select('stake_amount')
  .eq('winner_id', user.id)
  .eq('status', 'completed')
  .not('stake_amount', 'is', null),
supabase
  .from('friendly_withdrawal_requests')
  .select('id, amount, status, admin_note, requested_at, resolved_at')
  .eq('player_id', user.id)
  .order('requested_at', { ascending: false }),
```

Before the JSX return, build the props:

```typescript
  const friendlyWins = ((friendlyWinsRes.data ?? []) as { stake_amount: number | null }[]).map((w) => ({
    stakeAmount: w.stake_amount as number,
  }))
  const friendlyWithdrawals = (friendlyWithdrawalsRes.data ?? []) as FriendlyWithdrawalRow[]
```

In the JSX, right after `<ReferralPanel ... />`:

```tsx
<FriendlyWithdrawalPanel
  wins={friendlyWins}
  requests={friendlyWithdrawals}
  kycVerified={kyc?.kyc_status === 'verified'}
/>
```

- [ ] **Step 8: Write `app/admin/friendly-withdrawals/page.tsx` + `FriendlyWithdrawalQueueRow.tsx`**

`components/admin/FriendlyWithdrawalQueueRow.tsx`:

```tsx
'use client'
import { useFormState } from 'react-dom'
import { resolveFriendlyWithdrawal, type FriendlyWithdrawalResolveState } from '@/lib/friendly-withdrawals/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingFriendlyWithdrawal {
  id: string
  playerName: string
  amount: number
  bankName: string
  accountNumber: string
  accountName: string
}

export function FriendlyWithdrawalQueueRow({ req }: { req: PendingFriendlyWithdrawal }) {
  const [state, action] = useFormState<FriendlyWithdrawalResolveState, FormData>(
    resolveFriendlyWithdrawal,
    undefined,
  )

  return (
    <form action={action} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={req.id} />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">{req.playerName}</p>
        <p className="shrink-0 font-black text-white">{formatNaira(req.amount)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {req.bankName} · {req.accountNumber} · {req.accountName}
      </p>
      <textarea
        name="note"
        rows={2}
        placeholder="Note (required to reject)"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          name="action"
          value="paid"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
        >
          Pay
        </button>
        <button
          type="submit"
          name="action"
          value="rejected"
          className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Reject
        </button>
      </div>
    </form>
  )
}
```

`app/admin/friendly-withdrawals/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/auth'
import { formatDate, formatNaira } from '@/lib/format'
import { FriendlyWithdrawalQueueRow, type PendingFriendlyWithdrawal } from '@/components/admin/FriendlyWithdrawalQueueRow'

export const metadata: Metadata = { title: 'Friendly Withdrawals · Admin · SentinelX' }

type ProfileRef = { username: string | null; display_name: string | null } | { username: string | null; display_name: string | null }[] | null
function nameOf(p: ProfileRef): string {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return r?.display_name ?? r?.username ?? 'Player'
}
const RESOLVED_STATUS: Record<string, string> = {
  paid: 'text-emerald-400',
  rejected: 'text-red-400',
}

export default async function AdminFriendlyWithdrawalsPage() {
  await requireAdmin()
  const supabase = createClient()
  const [{ data: queueData }, { data: resolvedData }] = await Promise.all([
    supabase
      .from('friendly_withdrawal_requests')
      .select('id, amount, bank_name, account_number, account_name, profiles(username, display_name)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase
      .from('friendly_withdrawal_requests')
      .select('id, amount, status, admin_note, resolved_at, profiles(username, display_name)')
      .in('status', ['paid', 'rejected'])
      .order('resolved_at', { ascending: false })
      .limit(20),
  ])

  const queue: PendingFriendlyWithdrawal[] = ((queueData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      bank_name: string
      account_number: string
      account_name: string
      profiles: ProfileRef
    }
    return {
      id: w.id,
      playerName: nameOf(w.profiles),
      amount: w.amount,
      bankName: w.bank_name,
      accountNumber: w.account_number,
      accountName: w.account_name,
    }
  })

  const resolved = ((resolvedData as unknown[] | null) ?? []).map((raw) => {
    const w = raw as {
      id: string
      amount: number
      status: string
      admin_note: string | null
      resolved_at: string | null
      profiles: ProfileRef
    }
    return {
      id: w.id,
      playerName: nameOf(w.profiles),
      amount: w.amount,
      status: w.status,
      adminNote: w.admin_note,
      resolvedAt: w.resolved_at,
    }
  })

  return (
    <section className="space-y-8">
      <div>
        <h2 className="mb-4 text-base font-bold text-white">Needs action</h2>
        {queue.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No friendly withdrawals need action.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((req) => (
              <FriendlyWithdrawalQueueRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="mb-4 text-base font-bold text-white">Recently resolved</h2>
          <div className="space-y-2">
            {resolved.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-bold text-white">{r.playerName}</p>
                  <p className="shrink-0 text-sm">
                    {formatNaira(r.amount)}{' '}
                    <span className={`font-semibold ${RESOLVED_STATUS[r.status] ?? 'text-slate-400'}`}>
                      {r.status}
                    </span>
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(r.resolvedAt) ?? ''}
                  {r.adminNote ? ` · ${r.adminNote}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 9: Add the nav entry**

```typescript
  { label: 'Friendlies', href: '/admin/friendlies', adminOnly: true },
  { label: 'Friendly withdrawals', href: '/admin/friendly-withdrawals', adminOnly: true },
```

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add lib/notifications/inbox.ts lib/friendly-withdrawals/ components/dashboard/FriendlyWithdrawalPanel.tsx app/dashboard/page.tsx "app/admin/friendly-withdrawals/page.tsx" components/admin/FriendlyWithdrawalQueueRow.tsx lib/admin/nav.ts
git commit -m "feat: #26 staked-match balance + withdrawal (mirrors referral withdrawal pattern)"
```

---

### Task 13: Challenge UI on the player browse/profile surface

**Files:**
- Create: `components/player/ChallengeButton.tsx`
- Modify: `components/player/ProfileHeader.tsx`

**Interfaces:**
- Consumes: `sendChallenge` (Task 7).

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { sendChallenge, type FriendlyActionState } from '@/lib/friendly-matches/actions'

export function ChallengeButton({ opponentId }: { opponentId: string }) {
  const [showStake, setShowStake] = useState(false)
  const [state, action] = useFormState<FriendlyActionState, FormData>(sendChallenge, undefined)

  if (state?.success) return <p className="text-sm text-emerald-400">Challenge sent.</p>

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="opponentId" value={opponentId} />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={showStake} onChange={(e) => setShowStake(e.target.checked)} />
          Add a stake
        </label>
      </div>
      {showStake && (
        <input
          name="stakeAmount"
          type="number"
          min={100}
          placeholder="Stake amount (₦)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      )}
      <button
        type="submit"
        className="w-full rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        {showStake ? 'Send staked challenge' : 'Challenge to a friendly'}
      </button>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Render it alongside `AddFriendButton` in `ProfileHeader`**

```tsx
        {viewerId && viewerId !== profile.id && (
          <div className="mt-3 space-y-2">
            <AddFriendButton recipientId={profile.id} />
            <ChallengeButton opponentId={profile.id} />
          </div>
        )}
```

(add the import: `import { ChallengeButton } from '@/components/player/ChallengeButton'`)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/player/ChallengeButton.tsx components/player/ProfileHeader.tsx
git commit -m "feat: #26 challenge button (free or staked) on the player profile"
```

---

### Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 5: Manual smoke notes for the user**

The full staked-friendly money flow can't be exercised by automated tests. Post-deploy, manually walk through: send a staked challenge → accept → both pay (Paystack test mode) → confirm both `_paid` flags flip and Match Room unlocks → submit a result with a screenshot → admin confirms → verify Sentinel Score moved for both players and the winner's staked balance shows the correct pot → request a withdrawal → admin marks paid → confirm the notification bell fired at each step.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: #26 friend system + friendly matches verification fixes"
```

(Skip this step if Steps 1–4 passed clean with no changes needed.)
