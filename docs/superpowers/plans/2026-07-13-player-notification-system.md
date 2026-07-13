# Player Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-app notification bell in the site header (every breakpoint) covering 9 notification types — 8 retrofitted into already-shipped code, 1 (`friend_request`) reserved for #26 to use later.

**Architecture:** A new `player_notifications` table, distinct from the existing WhatsApp send-log `notifications` table. A `notifyInApp()` helper mirrors the existing `notify()` WhatsApp helper's shape exactly (internal service-role client, best-effort, never throws). The bell's data (unread count + recent list) is fetched once per page load as part of the existing `getNavSession()` call that already feeds the header, and passed down as props — no new fetch mechanism, no realtime subscription. Marking a notification read happens via a direct client-side Supabase call (RLS already permits a player to update their own row), with optimistic local state — not a Server Action.

**Tech Stack:** Next.js 14 App Router (Server Components, Server Actions), Supabase (Postgres + RLS), TypeScript, Tailwind, lucide-react.

## Global Constraints

- The new table is `player_notifications`, never confused with or merged into the existing `notifications` (WhatsApp send-log) table — see the design spec's §2 for why these are unrelated.
- `notifyInApp()` is best-effort: a failed insert must never break the caller's primary action (withdrawal resolution, result confirmation, etc.) — wrap in try/catch, swallow errors, exactly like `notify()`.
- The bell renders in `components/shared/SiteHeader.tsx` only, at every breakpoint (no `sm:` gating) — never added to `BottomTabBar`, never a mobile tab.
- No realtime subscription — the badge is server-computed per page load, matching the rest of the codebase (Supabase Realtime is used nowhere in this project).
- Migration file: `supabase/migrations/022_player_notifications.sql` (next after `021_full_day_matches.sql`).
- `type` CHECK constraint values: `listing_approved`, `listing_removed`, `withdrawal_paid`, `withdrawal_rejected`, `referral_withdrawal_paid`, `referral_withdrawal_rejected`, `result_confirmed`, `referral_credited`, `friend_request`. Only the first 8 are wired by this plan.

---

### Task 1: Migration — `player_notifications` table + RLS

**Files:**
- Create: `supabase/migrations/022_player_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE public.player_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid        NOT NULL REFERENCES public.profiles(id),
  type       text        NOT NULL
               CHECK (type IN (
                 'listing_approved', 'listing_removed',
                 'withdrawal_paid', 'withdrawal_rejected',
                 'referral_withdrawal_paid', 'referral_withdrawal_rejected',
                 'result_confirmed', 'referral_credited',
                 'friend_request'
               )),
  title      text        NOT NULL,
  body       text        NOT NULL,
  link       text,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.player_notifications (player_id, created_at DESC);

ALTER TABLE public.player_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_notifications_self_read" ON public.player_notifications
  FOR SELECT USING (player_id = auth.uid());
-- Self-update exists only so a player can mark their own notification read;
-- the client action only ever touches the `read` column.
CREATE POLICY "player_notifications_self_update" ON public.player_notifications
  FOR UPDATE USING (player_id = auth.uid());
-- No INSERT policy at all — writes only via notifyInApp()'s service-role client.
```

- [ ] **Step 2: Apply the migration**

Try `supabase db push --dry-run` then `supabase db push --yes`. If the CLI can't reach the DB, fall back to `mcp__claude_ai_Supabase__apply_migration` — ask the user to confirm before applying, showing the exact SQL. Check `supabase migration list` first if any prior migration this session was applied via the MCP path, and repair (`supabase migration repair --status applied <version>` / `--status reverted <stray-timestamp>`) before pushing.

- [ ] **Step 3: Regenerate Supabase types**

Overwrite `lib/supabase/types.ts`, preserving its existing header format.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/022_player_notifications.sql lib/supabase/types.ts
git commit -m "feat: add player_notifications table + RLS"
```

---

### Task 2: `lib/notifications/inbox.ts` — `notifyInApp()` helper

**Files:**
- Create: `lib/notifications/inbox.ts`

**Interfaces:**
- Produces: `NotificationType` (union of the 9 CHECK values), `notifyInApp(input): Promise<void>` — consumed by Tasks 6–10.

- [ ] **Step 1: Write the implementation**

No unit test — matches `lib/notifications/notify.ts`'s convention (a thin DB-orchestration function, not pure logic; no test file for that one either).

```typescript
import { createAdminClient } from '@/lib/supabase/admin'

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

// Best-effort — NEVER throws into the caller's primary action, mirroring
// lib/notifications/notify.ts's WhatsApp helper. A failed in-app notification
// insert must never break the withdrawal/result/listing action it's attached to.
export async function notifyInApp(input: {
  playerId: string
  type: NotificationType
  title: string
  body: string
  link?: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('player_notifications').insert({
      player_id: input.playerId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })
  } catch {
    // best-effort — swallow so the caller's action is never affected
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/notifications/inbox.ts
git commit -m "feat: notifyInApp() — in-app notification helper, mirrors the WhatsApp notify() shape"
```

---

### Task 3: `lib/nav/session.ts` — carry unread count + recent list

**Files:**
- Modify: `lib/nav/session.ts`

**Interfaces:**
- Produces: `NotificationItem` type, `NavSession.id`, `NavSession.unreadNotificationCount`, `NavSession.recentNotifications` — consumed by `components/shared/SiteHeader.tsx` (Task 5) and `components/shared/NotificationBell.tsx` (Task 4).

- [ ] **Step 1: Write the implementation**

```typescript
import { createClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/admin/auth'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

export interface NavSession {
  isLoggedIn: boolean
  isStaff: boolean
  id: string | null
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  unreadNotificationCount: number
  recentNotifications: NotificationItem[]
}

const LOGGED_OUT: NavSession = {
  isLoggedIn: false,
  isStaff: false,
  id: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  unreadNotificationCount: 0,
  recentNotifications: [],
}

export async function getNavSession(): Promise<NavSession> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return LOGGED_OUT

  const [{ data: profile }, staff, { count: unreadCount }, { data: notifRows }] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', user.id).maybeSingle(),
    getStaffContext(),
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

  const recentNotifications: NotificationItem[] = (notifRows ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    createdAt: n.created_at,
  }))

  return {
    isLoggedIn: true,
    isStaff: staff?.isStaff ?? false,
    id: user.id,
    username: profile?.username ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    unreadNotificationCount: unreadCount ?? 0,
    recentNotifications,
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: errors in `BottomTabBar.tsx`/`AccountMenu.tsx`/`SiteHeader.tsx` are expected at this point only if they destructure `NavSession` exhaustively (they don't — they read specific fields), so this step should be clean on its own. If any consumer errors appear, that's Task 5's job to fix; note them but don't fix here.

- [ ] **Step 3: Commit**

```bash
git add lib/nav/session.ts
git commit -m "feat: NavSession carries unread notification count + recent list"
```

---

### Task 4: `components/shared/NotificationBell.tsx` — the bell + dropdown

**Files:**
- Create: `components/shared/NotificationBell.tsx`

**Interfaces:**
- Consumes: `NotificationItem` (Task 3), `createClient` from `lib/supabase/client.ts`.

- [ ] **Step 1: Write the component**

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

  async function onSelect(n: NotificationItem) {
    setOpen(false)
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
      const supabase = createClient()
      await supabase.from('player_notifications').update({ read: true }).eq('id', n.id)
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

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add components/shared/NotificationBell.tsx
git commit -m "feat: NotificationBell component — dropdown, optimistic mark-as-read"
```

---

### Task 5: `components/shared/SiteHeader.tsx` — wire the bell in

**Files:**
- Modify: `components/shared/SiteHeader.tsx`

- [ ] **Step 1: Add the import and render the bell**

Add the import alongside the existing `AccountMenu` import:

```typescript
import { NotificationBell } from '@/components/shared/NotificationBell'
```

In the JSX, add the bell **before** the existing `<div className="hidden sm:block"><AccountMenu ... /></div>` block, rendered at every breakpoint (no `sm:` wrapper) and gated only on login state:

```tsx
          {/* Notifications — every breakpoint, never in the bottom tab bar */}
          {session.isLoggedIn && (
            <NotificationBell
              initialNotifications={session.recentNotifications}
              initialUnreadCount={session.unreadNotificationCount}
            />
          )}

          {/* Account — desktop only; mobile uses the bottom tab bar */}
          <div className="hidden sm:block">
            <AccountMenu session={session} />
          </div>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/shared/SiteHeader.tsx
git commit -m "feat: render NotificationBell in the site header at every breakpoint"
```

---

### Task 6: Retrofit — exchange listing approved/removed

**Files:**
- Modify: `lib/exchange/admin-actions.ts`

- [ ] **Step 1: Update the implementation**

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { notifyInApp } from '@/lib/notifications/inbox'

export type ActionState = { error?: string; success?: boolean } | undefined

async function setStatus(id: string, status: 'active' | 'removed'): Promise<ActionState> {
  await requireStaff()
  if (!id) return { error: 'Missing listing.' }
  const supabase = createClient()
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('seller_id, title')
    .eq('id', id)
    .maybeSingle()
  const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id)
  if (error) return { error: 'Could not update the listing.' }

  if (listing) {
    await notifyInApp({
      playerId: listing.seller_id,
      type: status === 'active' ? 'listing_approved' : 'listing_removed',
      title: status === 'active' ? 'Listing approved' : 'Listing removed',
      body:
        status === 'active'
          ? `Your listing "${listing.title}" is now live on the Exchange.`
          : `Your listing "${listing.title}" was removed by an admin.`,
      link: '/dashboard',
    })
  }

  revalidatePath('/exchange')
  revalidatePath('/admin/exchange')
  return { success: true }
}

export async function approveListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'active')
}
export async function removeListingAdmin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatus(String(formData.get('id') ?? ''), 'removed')
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/exchange/admin-actions.ts
git commit -m "feat: notify seller in-app on listing approved/removed"
```

---

### Task 7: Retrofit — prize withdrawal paid/rejected

**Files:**
- Modify: `lib/withdrawals/admin-actions.ts`

- [ ] **Step 1: Add the import and the two notification calls**

Add the import:

```typescript
import { notifyInApp } from '@/lib/notifications/inbox'
```

In the `action === 'rejected'` branch, after the successful update, before `revalidatePath`:

```typescript
    if (error) return { error: 'Could not resolve the request. Please try again.' }
    await notifyInApp({
      playerId: wr.player_id,
      type: 'withdrawal_rejected',
      title: 'Withdrawal rejected',
      body: note ? `Your withdrawal request was rejected: ${note}` : 'Your withdrawal request was rejected.',
      link: '/dashboard',
    })
    revalidatePath('/admin/withdrawals')
```

(`wr` from the earlier `select('status, player_id, amount')` query already has `player_id` — no extra fetch needed.)

In the manual `action === 'paid'` branch, after its successful update, before `revalidatePath`:

```typescript
  if (error) return { error: 'Could not mark this request paid. Please try again.' }
  await notifyInApp({
    playerId: wr.player_id,
    type: 'withdrawal_paid',
    title: 'Withdrawal paid',
    body: `Your withdrawal of ${formatNaira(wr.amount)} has been paid.`,
    link: '/dashboard',
  })

  revalidatePath('/admin/withdrawals')
```

This needs `formatNaira` imported too:

```typescript
import { formatNaira } from '@/lib/format'
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/withdrawals/admin-actions.ts
git commit -m "feat: notify player in-app on prize withdrawal paid/rejected"
```

---

### Task 8: Retrofit — referral withdrawal paid/rejected

**Files:**
- Modify: `lib/referrals/admin-actions.ts`

- [ ] **Step 1: Add the import and notification call**

Add the imports:

```typescript
import { notifyInApp } from '@/lib/notifications/inbox'
import { formatNaira } from '@/lib/format'
```

`resolveReferralWithdrawal` currently does one `select('status')` before resolving — widen it to also fetch `player_id, amount` (needed for the notification), then add the call after the update:

```typescript
  const { data: wr } = await supabase
    .from('referral_withdrawal_requests')
    .select('status, player_id, amount')
    .eq('id', id)
    .maybeSingle()
  if (!wr) return { error: 'Request not found.' }
  if (wr.status !== 'pending') return { error: 'This request has already been resolved.' }

  const { error } = await supabase
    .from('referral_withdrawal_requests')
    .update({
      status: action === 'paid' ? 'paid' : 'rejected',
      admin_note: note || null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the request. Please try again.' }

  await notifyInApp({
    playerId: wr.player_id,
    type: action === 'paid' ? 'referral_withdrawal_paid' : 'referral_withdrawal_rejected',
    title: action === 'paid' ? 'Referral withdrawal paid' : 'Referral withdrawal rejected',
    body:
      action === 'paid'
        ? `Your referral withdrawal of ${formatNaira(wr.amount)} has been paid.`
        : note
          ? `Your referral withdrawal was rejected: ${note}`
          : 'Your referral withdrawal was rejected.',
    link: '/dashboard',
  })

  revalidatePath('/admin/referrals')
  revalidatePath('/dashboard')
  return { success: true }
```

(This replaces the existing `select('status')` call and everything from the update onward — the function's earlier lines validating `id`/`action`/`note` are unchanged.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/referrals/admin-actions.ts
git commit -m "feat: notify player in-app on referral withdrawal paid/rejected"
```

---

### Task 9: Retrofit — match result confirmed

**Files:**
- Modify: `lib/matches/verify-actions.ts`

- [ ] **Step 1: Add the import and notification call alongside the existing WhatsApp notify**

Add the import:

```typescript
import { notifyInApp } from '@/lib/notifications/inbox'
```

`confirmResult` already loops over both players calling the WhatsApp `notify()` — add the in-app call in the same loop, right after the existing `notify(...)` call:

```typescript
    for (const pid of [nd.player_a_id, nd.player_b_id]) {
      if (!pid) continue
      await notify({
        type: 'result_confirmed',
        playerId: pid,
        dedupeKey: resultKey(id, pid),
        playerA: a,
        playerB: b,
        scoreA,
        scoreB,
        tournament: title,
      })
      await notifyInApp({
        playerId: pid,
        type: 'result_confirmed',
        title: 'Result confirmed',
        body: `${a} ${scoreA} – ${scoreB} ${b} — confirmed for ${title}.`,
        link: `/matches/${id}`,
      })
    }
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add lib/matches/verify-actions.ts
git commit -m "feat: notify both players in-app when a match result is confirmed"
```

---

### Task 10: Retrofit — referral credited

**Files:**
- Modify: `app/auth/confirm/route.ts`

- [ ] **Step 1: Add the import and notification call**

Add the import:

```typescript
import { notifyInApp } from '@/lib/notifications/inbox'
```

In `creditReferralIfAny`, after the successful (non-23505) insert, notify the referrer:

```typescript
async function creditReferralIfAny(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('referred_by')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.referred_by) return

  const { error } = await admin
    .from('referrals')
    .insert({ referrer_id: profile.referred_by, referred_id: userId })
  if (error) {
    if ((error as { code?: string }).code !== '23505') {
      console.error('[auth/confirm] referral credit failed', {
        userId,
        code: (error as { code?: string }).code,
        message: error.message,
      })
    }
    return
  }

  await notifyInApp({
    playerId: profile.referred_by,
    type: 'referral_credited',
    title: 'Referral credited',
    body: 'Someone you referred just joined Sentinel X — ₦100 added to your referral balance.',
    link: '/dashboard',
  })
}
```

(The notify call now only fires on a genuinely new insert, not on the idempotent-duplicate path — moved inside the success branch rather than running unconditionally after the insert attempt.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors referencing this file

- [ ] **Step 3: Commit**

```bash
git add app/auth/confirm/route.ts
git commit -m "feat: notify referrer in-app when their referral is credited"
```

---

### Task 11: Full verification pass

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

Since the bell's real-world trigger events span withdrawals/referrals/results/listings (all requiring live data to exercise), leave these as manual post-deploy checks:
1. Have an admin approve/reject a pending withdrawal or listing, confirm the affected player sees a badge + entry in the bell.
2. Click an unread notification, confirm it navigates to its link and the badge count decrements.
3. Confirm a match result, check both players get a bell entry.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: player notification system verification fixes"
```

(Skip this step if Steps 1–4 passed clean with no changes needed.)
