# Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the account-deletion feature that fails for 82 of 102 users with a working 15-day-grace flow that anonymises the profile in place instead of deleting it.

**Architecture:** The profile row survives as an anonymised tombstone, so none of the 57 foreign keys pointing at `profiles` need to change — the current failure exists only because the row is deleted. One FK is dropped (`profiles.id → auth.users`) so the auth user can be removed while the tombstone remains. Deletion becomes request → 15-day grace → execute, with a "Delete now" bypass, and the account is restricted from taking on new obligations while pending.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + Auth), vitest, next-intl, Resend.

**Spec:** `docs/superpowers/specs/2026-09-06-account-deletion-design.md`

## Global Constraints

- Mobile-first: design for 375px width, scale up.
- Every new table gets Row Level Security.
- Admin routes check role server-side; `requireAdmin()` from `lib/admin/auth.ts` for admin-only, `requireStaff()` for staff.
- Server Components by default; `"use client"` only where interactivity is needed.
- All new user-facing copy needs `en`, `fr` and `pcm` entries in `messages/*.json`. `messages/*.json` use **CRLF** line endings — insert textually, never rewrite via `JSON.stringify`, or every line shows as changed.
- Tests run with `npx vitest run <path>`. Typecheck with `npx tsc --noEmit`.
- **Do not run `npm run build` if another `next dev` is running in this checkout** — the two fight over `.next` and produce misleading unrelated errors. Check with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- Grace period is **15 days**. Tombstone display name is exactly `Deleted player`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

### Task 0: Disable the delete button in production (prerequisite)

**Files:**
- Modify: `components/settings/AccountSection.tsx`

**Why this must ship before Task 1.** Task 1 drops `profiles_id_fkey`. Between that migration landing and Task 9 replacing `deleteAccount`, production still runs the old delete path — and without the cascade, a successful delete would remove the auth user while leaving a fully-populated profile behind: username, phone, WhatsApp number, bio. That is a PII leak created purely by task ordering. Only ~20 of 102 users can currently delete at all, but the window is avoidable, so avoid it.

This task is **merged and deployed to production on its own**, before any migration is applied.

- [ ] **Step 1: Replace the button with an interim notice**

In `components/settings/AccountSection.tsx`, replace `<DeleteAccountButton />` with:

```tsx
<p className="text-xs leading-relaxed text-sx-gray">
  Account deletion is temporarily unavailable while we rebuild it. To delete
  your account in the meantime, email{' '}
  <a href="mailto:sentinelxesports@gmail.com" className="font-semibold text-sx-purple-text hover:text-sx-purple-light">
    sentinelxesports@gmail.com
  </a>{' '}
  and we will action it for you.
</p>
```

Leave `DeleteAccountButton` and `lib/settings/account.ts` in place — Task 9 rewrites them. Only the render is swapped.

A notice rather than silently removing the button: Privacy Policy §6 commits to honouring deletion requests, so users must still be told how to exercise that right while the feature is out.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If `DeleteAccountButton` is now unused, prefix it or add an eslint-disable rather than deleting it — Task 9 needs the surrounding file structure.

- [ ] **Step 3: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit, merge and deploy**

```bash
git add components/settings/AccountSection.tsx
git commit -m "chore(deletion): disable the broken delete button pending rebuild

It fails for 82 of 102 users, and the schema change that fixes it would
briefly leave the old path able to delete an auth user while orphaning a
fully-populated profile. Point users at support until the rebuild lands.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git checkout main && git merge <branch> && git push origin main
```

- [ ] **Step 5: Confirm it is live before proceeding**

Wait for the Vercel deployment to reach `READY`, then load `/dashboard/settings` in production and confirm the notice renders and no delete button remains. **Do not start Task 1 until this is confirmed** — the whole point is that production cannot run the old delete path once the FK is gone.

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/078_account_deletion.sql`

**Interfaces:**
- Produces: `profiles.deletion_requested_at`, `profiles.deleted_at`; tables `retired_usernames`, `banned_identifiers`, `admin_recovery_log`.

- [ ] **Step 1: Write the migration**

```sql
-- Account deletion: anonymise-in-place with a 15-day grace period.
-- See docs/superpowers/specs/2026-09-06-account-deletion-design.md

-- The profile must outlive its auth user. This cascade is the reason the
-- old hard-delete failed: it destroyed the row that 34 NO ACTION foreign
-- keys still referenced. profiles.id stays a plain uuid PK, and
-- handle_new_user() keeps populating it with the auth user's id.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;

-- Two distinct states: requested-and-not-deleted = in grace;
-- deleted_at set = tombstone. Cancelling clears deletion_requested_at.
ALTER TABLE public.profiles
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deleted_at            timestamptz;

CREATE INDEX profiles_deletion_pending_idx ON public.profiles (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX profiles_deleted_at_idx ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Holds ONLY the string: no user id, no FK. Once the profile is
-- anonymised this is not personal data, which is what lets us block reuse
-- permanently and still honour erasure.
CREATE TABLE public.retired_usernames (
  username    text PRIMARY KEY,
  retired_at  timestamptz NOT NULL DEFAULT now()
);

-- Ban evasion. Peppered one-way hashes, cheat-flagged accounts only.
CREATE TABLE public.banned_identifiers (
  hash        text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('email','phone')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Both admin recovery actions reverse a permanent decision, so they are
-- logged. There is no general admin audit trail in this codebase.
CREATE TABLE public.admin_recovery_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES public.profiles(id),
  action      text NOT NULL CHECK (action IN ('release_username','clear_identifier')),
  target      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- No client access to any of these. Every read and write goes through the
-- service-role client server-side, matching how username collisions are
-- already handled.
ALTER TABLE public.retired_usernames  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banned_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_recovery_log ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply it to production**

**Only after Task 0 is confirmed live.** Applied directly to production — no Supabase dev branch, by decision on 2026-09-06 (branches bill at $0.01344/hour and Task 0 closes the same window for free).

Apply via the Supabase MCP `apply_migration` tool (name: `078_account_deletion`), or `npx supabase db push` if the CLI is reachable. Note: the CLI is intermittently unreachable on this machine — prefer MCP.

Dropping a constraint is reversible while no orphaned profiles exist. If this needs backing out before Task 9 lands, re-add it with:

```sql
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id)
  REFERENCES auth.users(id) ON DELETE CASCADE;
```

- [ ] **Step 3: Verify**

Run this and confirm `profiles_id_fkey` is absent and all three tables exist:

```sql
SELECT conname FROM pg_constraint WHERE conname = 'profiles_id_fkey';
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('retired_usernames','banned_identifiers','admin_recovery_log');
```

Expected: first query returns 0 rows, second returns 3.

- [ ] **Step 4: Regenerate types**

```bash
npx supabase gen types typescript --project-id itxubrkbropttfdackmi > lib/supabase/types.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/078_account_deletion.sql lib/supabase/types.ts
git commit -m "feat(deletion): schema for anonymise-in-place account deletion

Drops profiles.id -> auth.users so the profile can outlive its auth user,
which is what lets the other 57 foreign keys stay untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Deletion guards (pure)

**Files:**
- Create: `lib/settings/deletion-guards.ts`
- Test: `lib/settings/deletion-guards.test.ts`

**Interfaces:**
- Produces: `type DeletionBlocker`, `checkCanDelete(input: DeletionGuardInput): DeletionBlocker[]`. Returns `[]` when deletion may proceed. Modelled on `checkCanRegister` in `lib/tournaments/guard.ts` — a pure function over already-fetched counts.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { checkCanDelete, type DeletionGuardInput } from './deletion-guards'

const clear: DeletionGuardInput = {
  walletBalance: 0,
  pendingWithdrawals: 0,
  openEscrowOrders: 0,
  activeListings: 0,
  activeTournaments: 0,
  unfinishedMatches: 0,
  unfinishedFriendlies: 0,
}

describe('checkCanDelete', () => {
  it('allows deletion when nothing is outstanding', () => {
    expect(checkCanDelete(clear)).toEqual([])
  })

  it('blocks on a wallet balance', () => {
    expect(checkCanDelete({ ...clear, walletBalance: 4500 })).toEqual([
      { code: 'wallet_balance', amount: 4500 },
    ])
  })

  it('blocks on a pending withdrawal', () => {
    expect(checkCanDelete({ ...clear, pendingWithdrawals: 1 })).toEqual([
      { code: 'pending_withdrawal', count: 1 },
    ])
  })

  it('blocks on an open escrow order', () => {
    expect(checkCanDelete({ ...clear, openEscrowOrders: 2 })).toEqual([
      { code: 'open_escrow_order', count: 2 },
    ])
  })

  it('blocks on a live listing', () => {
    expect(checkCanDelete({ ...clear, activeListings: 1 })).toEqual([
      { code: 'active_listing', count: 1 },
    ])
  })

  it('blocks on an active tournament', () => {
    expect(checkCanDelete({ ...clear, activeTournaments: 1 })).toEqual([
      { code: 'active_tournament', count: 1 },
    ])
  })

  it('blocks on an unfinished match', () => {
    expect(checkCanDelete({ ...clear, unfinishedMatches: 3 })).toEqual([
      { code: 'unfinished_match', count: 3 },
    ])
  })

  it('blocks on an unfinished friendly', () => {
    expect(checkCanDelete({ ...clear, unfinishedFriendlies: 1 })).toEqual([
      { code: 'unfinished_friendly', count: 1 },
    ])
  })

  // The UI renders one remedy per blocker, so they accumulate rather than
  // short-circuiting on the first.
  it('accumulates every blocker', () => {
    const result = checkCanDelete({
      ...clear,
      walletBalance: 500,
      activeTournaments: 1,
      openEscrowOrders: 1,
    })
    expect(result.map((b) => b.code)).toEqual([
      'wallet_balance',
      'pending_withdrawal' as never, // placeholder guard — see next assertion
    ].slice(0, 1).concat(['open_escrow_order', 'active_tournament']))
  })

  // SX Coins are non-cashable, so they are forfeited rather than blocking.
  it('does not block on coin balance', () => {
    expect(checkCanDelete({ ...clear })).toEqual([])
  })
})
```

Replace the awkward assertion in "accumulates every blocker" with this exact body:

```ts
  it('accumulates every blocker', () => {
    const result = checkCanDelete({
      ...clear,
      walletBalance: 500,
      activeTournaments: 1,
      openEscrowOrders: 1,
    })
    expect(result.map((b) => b.code)).toEqual([
      'wallet_balance',
      'open_escrow_order',
      'active_tournament',
    ])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/settings/deletion-guards.test.ts`
Expected: FAIL — `Cannot find module './deletion-guards'`

- [ ] **Step 3: Write the implementation**

```ts
// Pure guard over already-fetched counts, in the style of
// lib/tournaments/guard.ts checkCanRegister. Returns every blocker rather
// than the first, so the UI can render a remedy per item.
export type DeletionBlocker =
  | { code: 'wallet_balance'; amount: number }
  | { code: 'pending_withdrawal'; count: number }
  | { code: 'open_escrow_order'; count: number }
  | { code: 'active_listing'; count: number }
  | { code: 'active_tournament'; count: number }
  | { code: 'unfinished_match'; count: number }
  | { code: 'unfinished_friendly'; count: number }

export interface DeletionGuardInput {
  walletBalance: number
  pendingWithdrawals: number
  openEscrowOrders: number
  activeListings: number
  activeTournaments: number
  unfinishedMatches: number
  unfinishedFriendlies: number
}

// SX Coins are deliberately absent: they are non-cashable, so they are
// forfeited on deletion rather than blocking it.
export function checkCanDelete(input: DeletionGuardInput): DeletionBlocker[] {
  const blockers: DeletionBlocker[] = []
  if (input.walletBalance > 0) {
    blockers.push({ code: 'wallet_balance', amount: input.walletBalance })
  }
  if (input.pendingWithdrawals > 0) {
    blockers.push({ code: 'pending_withdrawal', count: input.pendingWithdrawals })
  }
  if (input.openEscrowOrders > 0) {
    blockers.push({ code: 'open_escrow_order', count: input.openEscrowOrders })
  }
  if (input.activeListings > 0) {
    blockers.push({ code: 'active_listing', count: input.activeListings })
  }
  if (input.activeTournaments > 0) {
    blockers.push({ code: 'active_tournament', count: input.activeTournaments })
  }
  if (input.unfinishedMatches > 0) {
    blockers.push({ code: 'unfinished_match', count: input.unfinishedMatches })
  }
  if (input.unfinishedFriendlies > 0) {
    blockers.push({ code: 'unfinished_friendly', count: input.unfinishedFriendlies })
  }
  return blockers
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/settings/deletion-guards.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add lib/settings/deletion-guards.ts lib/settings/deletion-guards.test.ts
git commit -m "feat(deletion): pure guards for outstanding obligations

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Grace window and restriction predicate (pure)

**Files:**
- Create: `lib/settings/grace.ts`
- Test: `lib/settings/grace.test.ts`

**Interfaces:**
- Produces: `GRACE_DAYS = 15`, `deletionDueAt(requestedAt: Date): Date`, `isGraceElapsed(requestedAt: Date, now: Date): boolean`, `daysRemaining(requestedAt: Date, now: Date): number`, `isPendingDeletion(p: { deletion_requested_at: string | null; deleted_at: string | null }): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  GRACE_DAYS,
  deletionDueAt,
  isGraceElapsed,
  daysRemaining,
  isPendingDeletion,
} from './grace'

const requested = new Date('2026-09-06T10:00:00Z')
const plus = (days: number, hours = 0) =>
  new Date(requested.getTime() + days * 86_400_000 + hours * 3_600_000)

describe('grace window', () => {
  it('is 15 days', () => {
    expect(GRACE_DAYS).toBe(15)
  })

  it('due date is 15 days after the request', () => {
    expect(deletionDueAt(requested).toISOString()).toBe('2026-09-21T10:00:00.000Z')
  })

  // Boundary: day 14 must not execute, day 15 must.
  it('has not elapsed on day 14', () => {
    expect(isGraceElapsed(requested, plus(14))).toBe(false)
  })

  it('has not elapsed one hour before the due moment', () => {
    expect(isGraceElapsed(requested, plus(14, 23))).toBe(false)
  })

  it('has elapsed exactly at the due moment', () => {
    expect(isGraceElapsed(requested, plus(15))).toBe(true)
  })

  it('has elapsed after the due moment', () => {
    expect(isGraceElapsed(requested, plus(20))).toBe(true)
  })

  it('counts days remaining, rounding up a partial day', () => {
    expect(daysRemaining(requested, requested)).toBe(15)
    expect(daysRemaining(requested, plus(3))).toBe(12)
    expect(daysRemaining(requested, plus(12, 1))).toBe(3)
    expect(daysRemaining(requested, plus(15))).toBe(0)
    expect(daysRemaining(requested, plus(30))).toBe(0)
  })
})

describe('isPendingDeletion', () => {
  it('is true while requested and not yet executed', () => {
    expect(
      isPendingDeletion({ deletion_requested_at: requested.toISOString(), deleted_at: null }),
    ).toBe(true)
  })

  it('is false for a live account', () => {
    expect(isPendingDeletion({ deletion_requested_at: null, deleted_at: null })).toBe(false)
  })

  // A tombstone is deleted, not pending — restrictions no longer apply
  // because there is nobody left to restrict.
  it('is false for a tombstone', () => {
    expect(
      isPendingDeletion({
        deletion_requested_at: requested.toISOString(),
        deleted_at: '2026-09-21T10:00:00Z',
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/settings/grace.test.ts`
Expected: FAIL — `Cannot find module './grace'`

- [ ] **Step 3: Write the implementation**

```ts
export const GRACE_DAYS = 15
const DAY_MS = 86_400_000

export function deletionDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + GRACE_DAYS * DAY_MS)
}

export function isGraceElapsed(requestedAt: Date, now: Date): boolean {
  return now.getTime() >= deletionDueAt(requestedAt).getTime()
}

// Rounded up, so a request with 2h 10m left still reads "1 day left"
// rather than "0" — a countdown that hits zero before anything happens
// reads as broken.
export function daysRemaining(requestedAt: Date, now: Date): number {
  const ms = deletionDueAt(requestedAt).getTime() - now.getTime()
  if (ms <= 0) return 0
  return Math.ceil(ms / DAY_MS)
}

// In grace = requested but not yet executed. A tombstone has deleted_at
// set and is no longer "pending".
export function isPendingDeletion(p: {
  deletion_requested_at: string | null
  deleted_at: string | null
}): boolean {
  return p.deletion_requested_at !== null && p.deleted_at === null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/settings/grace.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add lib/settings/grace.ts lib/settings/grace.test.ts
git commit -m "feat(deletion): grace-window arithmetic and pending predicate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Identifier hashing (pure)

**Files:**
- Create: `lib/settings/identifier-hash.ts`
- Test: `lib/settings/identifier-hash.test.ts`
- Modify: `.env.local.example` — add `DELETION_HASH_PEPPER=`

**Interfaces:**
- Produces: `hashIdentifier(value: string, pepper: string): string` — sha256 hex of `lower(trim(value)) + pepper`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { hashIdentifier } from './identifier-hash'

const PEPPER = 'test-pepper'

describe('hashIdentifier', () => {
  it('is stable for the same input', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).toBe(hashIdentifier('a@b.com', PEPPER))
  })

  it('returns a 64-character hex digest', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).toMatch(/^[0-9a-f]{64}$/)
  })

  // Signup must match regardless of how the user typed it.
  it('is case-insensitive', () => {
    expect(hashIdentifier('A@B.COM', PEPPER)).toBe(hashIdentifier('a@b.com', PEPPER))
  })

  it('ignores surrounding whitespace', () => {
    expect(hashIdentifier('  a@b.com  ', PEPPER)).toBe(hashIdentifier('a@b.com', PEPPER))
  })

  it('differs for different values', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).not.toBe(hashIdentifier('c@d.com', PEPPER))
  })

  // The pepper is what stops the table being reversed by hashing a list of
  // common addresses, so a different pepper must give a different digest.
  it('differs without the pepper', () => {
    expect(hashIdentifier('a@b.com', PEPPER)).not.toBe(hashIdentifier('a@b.com', ''))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/settings/identifier-hash.test.ts`
Expected: FAIL — `Cannot find module './identifier-hash'`

- [ ] **Step 3: Write the implementation**

```ts
import { createHash } from 'crypto'

// One-way, peppered. The pepper is a server-side secret so the
// banned_identifiers table cannot be reversed by hashing a list of common
// email addresses. Normalised so signup matches however the user typed it.
export function hashIdentifier(value: string, pepper: string): string {
  return createHash('sha256').update(value.trim().toLowerCase() + pepper).digest('hex')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/settings/identifier-hash.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Add the env var**

Append to `.env.local.example`:

```
# Pepper for the ban-evasion identifier hashes (account deletion). Any long
# random string; changing it orphans existing banned_identifiers rows.
DELETION_HASH_PEPPER=
```

- [ ] **Step 6: Commit**

```bash
git add lib/settings/identifier-hash.ts lib/settings/identifier-hash.test.ts .env.local.example
git commit -m "feat(deletion): peppered one-way identifier hashing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Tombstone display helper (pure)

**Files:**
- Create: `lib/players/display.ts`
- Test: `lib/players/display.test.ts`

**Interfaces:**
- Produces: `DELETED_PLAYER_NAME`, `type ProfileRef`, `isDeleted(p)`, `displayNameFor(p)`, `profileHrefFor(p)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  DELETED_PLAYER_NAME,
  isDeleted,
  displayNameFor,
  profileHrefFor,
} from './display'

const live = { username: 'sniperking', display_name: 'Sniper King', deleted_at: null }
const tombstone = { username: 'deleted_a1b2c3d4', display_name: 'Deleted player', deleted_at: '2026-09-21T10:00:00Z' }

describe('isDeleted', () => {
  it('is false for a live profile', () => {
    expect(isDeleted(live)).toBe(false)
  })
  it('is true for a tombstone', () => {
    expect(isDeleted(tombstone)).toBe(true)
  })
})

describe('displayNameFor', () => {
  it('prefers display_name for a live profile', () => {
    expect(displayNameFor(live)).toBe('Sniper King')
  })

  it('falls back to username when display_name is missing', () => {
    expect(displayNameFor({ ...live, display_name: null })).toBe('sniperking')
  })

  it('falls back to Player when both are missing', () => {
    expect(displayNameFor({ username: null, display_name: null, deleted_at: null })).toBe('Player')
  })

  // The tombstone name wins even though the row still carries the
  // anonymised username, so no surface can leak 'deleted_a1b2c3d4'.
  it('always returns the tombstone name for a deleted profile', () => {
    expect(displayNameFor(tombstone)).toBe(DELETED_PLAYER_NAME)
  })

  it('returns the tombstone name even if stale identity survives', () => {
    expect(displayNameFor({ ...live, deleted_at: '2026-09-21T10:00:00Z' })).toBe(DELETED_PLAYER_NAME)
  })

  it('handles a null profile', () => {
    expect(displayNameFor(null)).toBe('Player')
  })
})

describe('profileHrefFor', () => {
  it('links a live profile by username', () => {
    expect(profileHrefFor(live)).toBe('/players/sniperking')
  })

  // The handle is retired and /players/[username] 404s, so there must be
  // no link to follow.
  it('returns null for a deleted profile', () => {
    expect(profileHrefFor(tombstone)).toBeNull()
  })

  it('returns null when there is no username', () => {
    expect(profileHrefFor({ username: null, display_name: 'X', deleted_at: null })).toBeNull()
  })

  it('returns null for a null profile', () => {
    expect(profileHrefFor(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/players/display.test.ts`
Expected: FAIL — `Cannot find module './display'`

- [ ] **Step 3: Write the implementation**

```ts
export const DELETED_PLAYER_NAME = 'Deleted player'

export type ProfileRef = {
  username: string | null
  display_name: string | null
  deleted_at: string | null
} | null

export function isDeleted(p: ProfileRef): boolean {
  return p?.deleted_at != null
}

// Checked before any identity field is read, so an anonymised row can
// never leak its 'deleted_<id>' placeholder into the UI.
export function displayNameFor(p: ProfileRef): string {
  if (p == null) return 'Player'
  if (isDeleted(p)) return DELETED_PLAYER_NAME
  return p.display_name ?? p.username ?? 'Player'
}

// null means "render as plain text, not a link" — /players/[username]
// returns notFound() for a retired handle.
export function profileHrefFor(p: ProfileRef): string | null {
  if (p == null || isDeleted(p) || p.username == null) return null
  return `/players/${p.username}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/players/display.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add lib/players/display.ts lib/players/display.test.ts
git commit -m "feat(deletion): tombstone display helper

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Transactional email sender

**Files:**
- Create: `lib/email/send.ts`
- Test: `lib/email/send.test.ts`
- Modify: `.env.local.example` — add `RESEND_API_KEY=` and `EMAIL_FROM=`

**Interfaces:**
- Produces: `sendEmail(input: { to: string; subject: string; html: string }): Promise<boolean>` — resolves `false` and never throws when unconfigured or on failure.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from './send'

const input = { to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' }

describe('sendEmail', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('EMAIL_FROM', 'SentinelX <noreply@sentinelxesports.com.ng>')
    vi.restoreAllMocks()
  })
  afterEach(() => vi.unstubAllEnvs())

  // Same no-op-when-unconfigured contract as TERMII_API_KEY, so local dev
  // and CI never attempt a real send.
  it('no-ops when the API key is absent', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await sendEmail(input)).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts to the Resend API and reports success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    expect(await sendEmail(input)).toBe(true)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.to).toEqual(['a@b.com'])
    expect(body.subject).toBe('Hi')
  })

  it('reports failure on a non-2xx response without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }))
    expect(await sendEmail(input)).toBe(false)
  })

  // Deletion must never fail because an email did.
  it('swallows a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await sendEmail(input)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email/send.test.ts`
Expected: FAIL — `Cannot find module './send'`

- [ ] **Step 3: Write the implementation**

```ts
// Minimal Resend wrapper. Best-effort by contract: returns false rather
// than throwing, so a failed email never aborts the deletion it accompanies.
// No-ops when unconfigured, the same pattern lib/notifications/termii.ts
// uses for TERMII_API_KEY.
export async function sendEmail(input: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) return false

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
    })
    if (!res.ok) {
      console.error('sendEmail failed', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.error('sendEmail threw', err)
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/email/send.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Add env vars**

Append to `.env.local.example`:

```
# Transactional email (Resend). Leave RESEND_API_KEY blank to disable
# sending (no-op), same pattern as TERMII_API_KEY above.
RESEND_API_KEY=
EMAIL_FROM=SentinelX Esports <noreply@sentinelxesports.com.ng>
```

- [ ] **Step 6: Commit**

```bash
git add lib/email/send.ts lib/email/send.test.ts .env.local.example
git commit -m "feat(email): minimal Resend transactional sender

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Anonymise RPC

**Files:**
- Create: `supabase/migrations/079_anonymise_account.sql`

**Interfaces:**
- Produces: `public.anonymise_account(p_id uuid)` — SECURITY DEFINER. Anonymises the profile, retires the username, deletes the private tables. Does **not** touch `auth.users`; the caller does that afterwards.

- [ ] **Step 1: Write the migration**

```sql
-- Steps 2, 3 and 5 of the execution flow in one transaction, so a partial
-- anonymisation cannot occur. The caller deletes the auth user afterwards
-- (a separate Auth API call that cannot join this transaction) and writes
-- the ban hashes, which need the plaintext email this function never sees.
CREATE OR REPLACE FUNCTION public.anonymise_account(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  SELECT username INTO v_username FROM public.profiles WHERE id = p_id;

  -- Retire the handle. Done here rather than at request time so a
  -- cancelled deletion leaves it untouched.
  IF v_username IS NOT NULL THEN
    INSERT INTO public.retired_usernames (username)
    VALUES (v_username)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Competitive stats (sx_score, wins, losses, total_titles, xp,
  -- membership_tier, sentinel_tier) are deliberately kept: they are the
  -- substance of the match history being retained and the leaderboards it
  -- feeds.
  UPDATE public.profiles SET
    username           = 'deleted_' || substr(p_id::text, 1, 8),
    display_name       = 'Deleted player',
    avatar_url         = NULL,
    country            = NULL,
    phone              = NULL,
    whatsapp_number    = NULL,
    bio                = NULL,
    notification_prefs = '{}'::jsonb,
    last_login_date    = NULL,
    login_streak       = 0,
    deleted_at         = now(),
    updated_at         = now()
  WHERE id = p_id;

  -- Private and referenced by nobody.
  DELETE FROM public.fcm_tokens                WHERE player_id = p_id;
  DELETE FROM public.phone_verifications       WHERE user_id   = p_id;
  DELETE FROM public.player_kyc                WHERE player_id = p_id;
  DELETE FROM public.game_interest             WHERE user_id   = p_id;
  DELETE FROM public.player_challenge_progress WHERE player_id = p_id;
  DELETE FROM public.player_store_items        WHERE player_id = p_id;
  DELETE FROM public.notifications             WHERE player_id = p_id;
  DELETE FROM public.player_notifications      WHERE player_id = p_id;
  DELETE FROM public.tournament_invitations    WHERE player_id = p_id;
  DELETE FROM public.user_roles                WHERE user_id   = p_id;
  DELETE FROM public.xp_events                 WHERE player_id = p_id;
  -- A mutual relationship ends when one side leaves.
  DELETE FROM public.friends
    WHERE requester_id = p_id OR recipient_id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_account(uuid) FROM public, anon, authenticated;
```

- [ ] **Step 2: Apply it**

Apply via the Supabase MCP `apply_migration` tool (name: `079_anonymise_account`).

- [ ] **Step 3: Verify on a throwaway row**

In a Supabase branch or against a test account only — **never a real user**:

```sql
BEGIN;
SELECT public.anonymise_account('<test-uuid>');
SELECT username, display_name, deleted_at, phone, bio FROM public.profiles WHERE id = '<test-uuid>';
SELECT count(*) FROM public.retired_usernames;
ROLLBACK;
```

Expected: `display_name` is `Deleted player`, `username` starts `deleted_`, `deleted_at` set, `phone` and `bio` null, one new retired username. The ROLLBACK undoes it all.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/079_anonymise_account.sql
git commit -m "feat(deletion): anonymise_account RPC

Anonymise, retire the username and clear the private tables in one
transaction, so a partial anonymisation cannot occur.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Deletion service

**Files:**
- Create: `lib/settings/deletion-service.ts`
- Test: `lib/settings/deletion-service.test.ts`

**Interfaces:**
- Consumes: `checkCanDelete` (Task 2), `hashIdentifier` (Task 4), `anonymise_account` RPC (Task 7), `sendEmail` (Task 6).
- Produces: `fetchGuardInput(admin, playerId): Promise<DeletionGuardInput>`, `executeDeletion(admin, playerId): Promise<{ ok: true } | { ok: false; blockers: DeletionBlocker[] }>`.

- [ ] **Step 1: Write the failing test**

Only `fetchGuardInput`'s shaping is unit-testable without a database; `executeDeletion` is covered by the integration checks in Task 17. Test the query-count mapping:

```ts
import { describe, it, expect } from 'vitest'
import { toGuardInput } from './deletion-service'

describe('toGuardInput', () => {
  it('maps null counts to zero', () => {
    expect(
      toGuardInput({
        walletBalance: null,
        pendingWithdrawals: null,
        openEscrowOrders: null,
        activeListings: null,
        activeTournaments: null,
        unfinishedMatches: null,
        unfinishedFriendlies: null,
      }),
    ).toEqual({
      walletBalance: 0,
      pendingWithdrawals: 0,
      openEscrowOrders: 0,
      activeListings: 0,
      activeTournaments: 0,
      unfinishedMatches: 0,
      unfinishedFriendlies: 0,
    })
  })

  it('passes through real counts', () => {
    expect(
      toGuardInput({
        walletBalance: 4500,
        pendingWithdrawals: 1,
        openEscrowOrders: 0,
        activeListings: 2,
        activeTournaments: 1,
        unfinishedMatches: 3,
        unfinishedFriendlies: 0,
      }).walletBalance,
    ).toBe(4500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/settings/deletion-service.test.ts`
Expected: FAIL — `Cannot find module './deletion-service'`

- [ ] **Step 3: Write the implementation**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { checkCanDelete, type DeletionBlocker, type DeletionGuardInput } from './deletion-guards'
import { hashIdentifier } from './identifier-hash'
import { sendEmail } from '@/lib/email/send'

type Admin = SupabaseClient<Database>
type RawCounts = { [K in keyof DeletionGuardInput]: number | null }

export function toGuardInput(raw: RawCounts): DeletionGuardInput {
  return {
    walletBalance: raw.walletBalance ?? 0,
    pendingWithdrawals: raw.pendingWithdrawals ?? 0,
    openEscrowOrders: raw.openEscrowOrders ?? 0,
    activeListings: raw.activeListings ?? 0,
    activeTournaments: raw.activeTournaments ?? 0,
    unfinishedMatches: raw.unfinishedMatches ?? 0,
    unfinishedFriendlies: raw.unfinishedFriendlies ?? 0,
  }
}

const OPEN_ORDER = ['initiated', 'payment_held']
const LIVE_TOURNAMENT = ['registration_open', 'registration_closed', 'active']
const UNFINISHED_MATCH = ['scheduled', 'live', 'disputed']
const UNFINISHED_FRIENDLY = [
  'pending',
  'awaiting_payment',
  'active',
  'awaiting_admin_confirmation',
  'disputed',
]

export async function fetchGuardInput(admin: Admin, playerId: string): Promise<DeletionGuardInput> {
  const [wallet, withdrawals, ordersBuy, ordersSell, listings, regs, matchesA, matchesB, friendliesC, friendliesO] =
    await Promise.all([
      admin.from('wallets').select('balance').eq('player_id', playerId).maybeSingle(),
      admin.from('withdrawal_requests').select('id', { count: 'exact', head: true })
        .eq('player_id', playerId).eq('status', 'pending'),
      admin.from('marketplace_orders').select('id', { count: 'exact', head: true })
        .eq('buyer_id', playerId).in('status', OPEN_ORDER),
      admin.from('marketplace_orders').select('id', { count: 'exact', head: true })
        .eq('seller_id', playerId).in('status', OPEN_ORDER),
      admin.from('marketplace_listings').select('id', { count: 'exact', head: true })
        .eq('seller_id', playerId).eq('status', 'active'),
      admin.from('tournament_registrations')
        .select('id, tournaments!inner(status)', { count: 'exact', head: true })
        .eq('player_id', playerId).eq('status', 'active')
        .in('tournaments.status', LIVE_TOURNAMENT),
      admin.from('matches').select('id', { count: 'exact', head: true })
        .eq('player_a_id', playerId).in('status', UNFINISHED_MATCH),
      admin.from('matches').select('id', { count: 'exact', head: true })
        .eq('player_b_id', playerId).in('status', UNFINISHED_MATCH),
      admin.from('friendly_matches').select('id', { count: 'exact', head: true })
        .eq('challenger_id', playerId).in('status', UNFINISHED_FRIENDLY),
      admin.from('friendly_matches').select('id', { count: 'exact', head: true })
        .eq('opponent_id', playerId).in('status', UNFINISHED_FRIENDLY),
    ])

  return toGuardInput({
    walletBalance: wallet.data?.balance ?? 0,
    pendingWithdrawals: withdrawals.count,
    openEscrowOrders: (ordersBuy.count ?? 0) + (ordersSell.count ?? 0),
    activeListings: listings.count,
    activeTournaments: regs.count,
    unfinishedMatches: (matchesA.count ?? 0) + (matchesB.count ?? 0),
    unfinishedFriendlies: (friendliesC.count ?? 0) + (friendliesO.count ?? 0),
  })
}

// Steps 1-7 of spec §9. Shared by the cron route and "Delete now".
export async function executeDeletion(
  admin: Admin,
  playerId: string,
): Promise<{ ok: true } | { ok: false; blockers: DeletionBlocker[] }> {
  const blockers = checkCanDelete(await fetchGuardInput(admin, playerId))
  if (blockers.length > 0) return { ok: false, blockers }

  // Read the email and cheat-flag state BEFORE anonymising — the RPC
  // clears the phone, and deleting the auth user takes the email with it.
  const { data: authUser } = await admin.auth.admin.getUserById(playerId)
  const email = authUser?.user?.email ?? null
  const { data: profile } = await admin
    .from('profiles')
    .select('phone')
    .eq('id', playerId)
    .maybeSingle()
  const { count: cheatFlags } = await admin
    .from('admin_flags')
    .select('id', { count: 'exact', head: true })
    .eq('player_id', playerId)
    .eq('severity', 'cheat')

  await admin.rpc('anonymise_account', { p_id: playerId })

  // Only cheat-flagged accounts. A conduct flag must not bar someone for
  // life.
  if ((cheatFlags ?? 0) > 0) {
    const pepper = process.env.DELETION_HASH_PEPPER ?? ''
    const rows: { hash: string; kind: 'email' | 'phone' }[] = []
    if (email) rows.push({ hash: hashIdentifier(email, pepper), kind: 'email' })
    if (profile?.phone) rows.push({ hash: hashIdentifier(profile.phone, pepper), kind: 'phone' })
    if (rows.length > 0) {
      await admin.from('banned_identifiers').upsert(rows, { onConflict: 'hash', ignoreDuplicates: true })
    }
  }

  // Before the address disappears with the auth user.
  if (email) {
    await sendEmail({
      to: email,
      subject: 'Your SentinelX account has been deleted',
      html: '<p>Your SentinelX Esports account has been permanently deleted. This cannot be undone.</p>',
    })
  }

  const { error } = await admin.auth.admin.deleteUser(playerId)
  if (error) {
    // The profile is already anonymised and the user is effectively gone,
    // so deleted_at stands. Logged for admin follow-up rather than rolled
    // back — a rollback would resurrect an account the user has left.
    console.error('executeDeletion: auth user delete failed', playerId, error)
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/settings/deletion-service.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add lib/settings/deletion-service.ts lib/settings/deletion-service.test.ts
git commit -m "feat(deletion): guard fetching and the shared execution path

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Server Actions — request, cancel, delete now

**Files:**
- Modify: `lib/settings/account.ts` — replace `deleteAccount`

**Interfaces:**
- Consumes: `fetchGuardInput`, `executeDeletion` (Task 8), `checkCanDelete` (Task 2), `deletionDueAt` (Task 3), `sendEmail` (Task 6).
- Produces: `requestAccountDeletion(prev, formData)`, `cancelAccountDeletion()`, `deleteAccountNow(prev, formData)`, `type DeleteAccountState = { error?: string; blockers?: DeletionBlocker[] } | undefined`.

- [ ] **Step 1: Replace the file**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkCanDelete, type DeletionBlocker } from './deletion-guards'
import { fetchGuardInput, executeDeletion } from './deletion-service'
import { deletionDueAt } from './grace'
import { sendEmail } from '@/lib/email/send'
import { SITE_URL } from '@/lib/seo/site'

export type DeleteAccountState =
  | { error?: string; blockers?: DeletionBlocker[] }
  | undefined

// Starts the 15-day grace period. Nothing is destroyed here — the account
// is only marked, and the user can cancel until the cron executes it.
export async function requestAccountDeletion(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  if (formData.get('confirm') !== 'DELETE') {
    return { error: 'Type DELETE to confirm.' }
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const blockers = checkCanDelete(await fetchGuardInput(admin, user.id))
  if (blockers.length > 0) return { blockers }

  const requestedAt = new Date()
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: requestedAt.toISOString() })
    .eq('id', user.id)
  if (error) {
    console.error('requestAccountDeletion failed', error)
    return { error: 'Could not schedule deletion. Please try again.' }
  }

  const due = deletionDueAt(requestedAt)
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account is scheduled for deletion',
      html:
        `<p>Your SentinelX Esports account is scheduled for deletion on ` +
        `<strong>${due.toDateString()}</strong>.</p>` +
        `<p>You can cancel any time before then by signing in: ` +
        `<a href="${SITE_URL}/dashboard/settings">${SITE_URL}/dashboard/settings</a></p>`,
    })
  }
  revalidatePath('/', 'layout')
  return undefined
}

export async function cancelAccountDeletion(): Promise<DeleteAccountState> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ deletion_requested_at: null })
    .eq('id', user.id)
    .is('deleted_at', null)
  if (error) {
    console.error('cancelAccountDeletion failed', error)
    return { error: 'Could not cancel. Please try again.' }
  }
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Your SentinelX account deletion was cancelled',
      html: '<p>Your account is no longer scheduled for deletion. Nothing was lost.</p>',
    })
  }
  revalidatePath('/', 'layout')
  return undefined
}

// Skips the grace period. Gated on typing the exact username rather than
// DELETE: a higher bar that works the same for password and Google
// accounts, since Google users have no password to re-enter.
export async function deleteAccountNow(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  const typed = String(formData.get('confirm') ?? '').trim()
  if (!profile?.username || typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { error: 'That does not match your username.' }
  }

  const result = await executeDeletion(admin, user.id)
  if (!result.ok) return { blockers: result.blockers }
  revalidatePath('/', 'layout')
  return undefined
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Confirm no stale imports**

Run: `npx vitest run` — the whole suite, to catch any file still importing the removed `deleteAccount`.
Expected: PASS. If `components/settings/AccountSection.tsx` fails to typecheck, that is expected and fixed in Task 13.

- [ ] **Step 4: Commit**

```bash
git add lib/settings/account.ts
git commit -m "feat(deletion): request, cancel and delete-now Server Actions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Cron route

**Files:**
- Create: `app/api/cron/execute-account-deletions/route.ts`

**Interfaces:**
- Consumes: `executeDeletion` (Task 8), `GRACE_DAYS` (Task 3).

- [ ] **Step 1: Write the route**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { executeDeletion } from '@/lib/settings/deletion-service'
import { GRACE_DAYS } from '@/lib/settings/grace'
import { sendEmail } from '@/lib/email/send'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString()

  const { data: due } = await admin
    .from('profiles')
    .select('id')
    .lte('deletion_requested_at', cutoff)
    .is('deleted_at', null)
    .not('deletion_requested_at', 'is', null)

  let executed = 0
  let paused = 0
  for (const row of due ?? []) {
    // Read the email before executeDeletion removes the auth user, so a
    // paused account can still be told why.
    const { data: authUser } = await admin.auth.admin.getUserById(row.id)
    const email = authUser?.user?.email ?? null

    const result = await executeDeletion(admin, row.id)
    if (result.ok) {
      executed++
      continue
    }
    // Paused, not cancelled and not silently dropped: the pending state
    // stands so the next run retries, and the user is told why.
    paused++
    console.error('deletion paused by guards', row.id, result.blockers)
    if (email) {
      await sendEmail({
        to: email,
        subject: 'Your SentinelX account deletion is on hold',
        html:
          '<p>We could not complete your account deletion because something is still ' +
          'outstanding on your account. Sign in to review it — we will try again daily.</p>',
      })
    }
  }

  // Spec §8: reminder at 3 days remaining, i.e. requested 12 days ago.
  // Windowed to a single day so a daily run sends it exactly once without
  // needing a "reminded" column.
  const remindFrom = new Date(Date.now() - 13 * 86_400_000).toISOString()
  const remindTo = new Date(Date.now() - 12 * 86_400_000).toISOString()
  const { data: reminders } = await admin
    .from('profiles')
    .select('id')
    .gte('deletion_requested_at', remindFrom)
    .lt('deletion_requested_at', remindTo)
    .is('deleted_at', null)

  let reminded = 0
  for (const row of reminders ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(row.id)
    const email = authUser?.user?.email
    if (!email) continue
    await sendEmail({
      to: email,
      subject: 'Your SentinelX account will be deleted in 3 days',
      html:
        '<p>Your SentinelX Esports account is scheduled for deletion in 3 days.</p>' +
        `<p>If you want to keep it, sign in and cancel: ` +
        `<a href="${SITE_URL}/dashboard/settings">${SITE_URL}/dashboard/settings</a></p>`,
    })
    reminded++
  }

  return Response.json({ due: due?.length ?? 0, executed, paused, reminded })
}
```

Add `import { SITE_URL } from '@/lib/seo/site'` to the imports — never re-declare a local `NEXT_PUBLIC_SITE_URL` fallback, that duplication is what put a domain nobody owned into ten files.

- [ ] **Step 2: Verify it rejects an unauthenticated call**

Start the dev server (only if no other `next dev` is running — see Global Constraints), then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/cron/execute-account-deletions
```

Expected: `401`

- [ ] **Step 3: Verify an authorised call returns the summary**

```bash
curl -s -X POST -H "authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/execute-account-deletions
```

Expected: `{"due":0,"executed":0,"paused":0}` on a database with no pending deletions.

- [ ] **Step 4: Schedule it**

Add a daily `pg_cron` entry alongside the existing cron jobs, calling this route with the `CRON_SECRET` bearer token. Follow whatever mechanism `app/api/cron/fixture-reminders` already uses — check the Supabase dashboard's cron jobs for the existing pattern rather than inventing a new one.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/execute-account-deletions/route.ts
git commit -m "feat(deletion): daily cron to execute elapsed grace periods

Guard failures pause the deletion and notify rather than dropping it, so
the pending state stands and the next run retries.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Signup blocks retired usernames and banned identifiers

**Files:**
- Modify: `lib/auth/actions.ts` — the signup action
- Modify: `lib/onboarding/actions.ts:9` — `claimUsername`, the deferred-claim path for signups that arrive without a username
- Test: `lib/auth/signup-blocks.test.ts`

There is no separate username-availability API route in this codebase — uniqueness is enforced by the DB `UNIQUE` constraint, with Postgres `23505` mapped to a friendly message. So both write paths above need the retired check; there is no third place to update.

**Interfaces:**
- Consumes: `hashIdentifier` (Task 4).
- Produces: `isUsernameAvailable(admin, username): Promise<boolean>`, `isIdentifierBanned(admin, value): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { isUsernameAvailable, isIdentifierBanned } from './signup-blocks'

// Minimal fake matching the two query shapes these functions use.
function fakeAdmin(opts: { retired?: string[]; banned?: string[] }) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              const list = table === 'retired_usernames' ? opts.retired : opts.banned
              return { data: (list ?? []).includes(val) ? { x: 1 } : null }
            },
          }),
        }),
      }
    },
  } as never
}

describe('isUsernameAvailable', () => {
  it('rejects a retired username', async () => {
    expect(await isUsernameAvailable(fakeAdmin({ retired: ['sniperking'] }), 'sniperking')).toBe(false)
  })

  it('rejects it case-insensitively', async () => {
    expect(await isUsernameAvailable(fakeAdmin({ retired: ['sniperking'] }), 'SniperKing')).toBe(false)
  })

  it('allows a free username', async () => {
    expect(await isUsernameAvailable(fakeAdmin({ retired: [] }), 'newname')).toBe(true)
  })
})

describe('isIdentifierBanned', () => {
  it('is false when nothing matches', async () => {
    expect(await isIdentifierBanned(fakeAdmin({ banned: [] }), 'a@b.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/auth/signup-blocks.test.ts`
Expected: FAIL — `Cannot find module './signup-blocks'`

- [ ] **Step 3: Write the implementation**

Create `lib/auth/signup-blocks.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { hashIdentifier } from '@/lib/settings/identifier-hash'

type Admin = SupabaseClient<Database>

// Retired handles are stored lowercase; callers may pass any casing.
export async function isUsernameAvailable(admin: Admin, username: string): Promise<boolean> {
  const { data } = await admin
    .from('retired_usernames')
    .select('username')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle()
  return data == null
}

export async function isIdentifierBanned(admin: Admin, value: string): Promise<boolean> {
  const { data } = await admin
    .from('banned_identifiers')
    .select('hash')
    .eq('hash', hashIdentifier(value, process.env.DELETION_HASH_PEPPER ?? ''))
    .maybeSingle()
  return data != null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/auth/signup-blocks.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire into signup**

In `lib/auth/actions.ts`, inside the signup action, before calling `supabase.auth.signUp`:

```ts
const admin = createAdminClient()
// Generic message either way: a distinct one would let anyone probe the
// blocklist for a given address.
if (await isIdentifierBanned(admin, email)) {
  return { error: 'We could not create an account with those details.' }
}
if (!(await isUsernameAvailable(admin, username))) {
  return { error: 'That username is taken.' }
}
```

Add the matching check to the live username-availability endpoint found in Step 0 of this task's Files list, so the signup wizard shows a retired handle as taken while typing rather than only on submit.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all pass

- [ ] **Step 7: Commit**

```bash
git add lib/auth/signup-blocks.ts lib/auth/signup-blocks.test.ts lib/auth/actions.ts
git commit -m "feat(deletion): block retired usernames and banned identifiers at signup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Restrict pending accounts from new obligations

**Files:**
- Create: `lib/settings/restriction.ts`
- Test: `lib/settings/restriction.test.ts`
- Modify, one call site each:
  - `lib/tournaments/actions.ts` — `registerForTournament`
  - `lib/tournaments/waitlist-actions.ts:13` — `joinWaitlist`
  - `lib/exchange/actions.ts` — listing creation
  - `lib/exchange/purchase.ts` — buying
  - `lib/exchange/requests-actions.ts` — buy requests
  - `lib/friendly-matches/actions.ts` — issue and accept a challenge
  - `lib/friendly-matches/pay-actions.ts` — `payStake`
  - `lib/wallet/deposit.ts` — `initiateWalletDeposit`
  - `lib/wallet/actions.ts:12` — `requestWalletWithdrawal`
  - `lib/wagers/actions.ts` — placing a wager

**Interfaces:**
- Consumes: `isPendingDeletion` (Task 3).
- Produces: `assertNotPendingDeletion(admin, playerId): Promise<string | null>` — returns an error message, or `null` when permitted.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { restrictionMessage } from './restriction'

describe('restrictionMessage', () => {
  it('permits a live account', () => {
    expect(restrictionMessage({ deletion_requested_at: null, deleted_at: null })).toBeNull()
  })

  it('blocks an account pending deletion', () => {
    expect(
      restrictionMessage({ deletion_requested_at: '2026-09-06T10:00:00Z', deleted_at: null }),
    ).toBe('Your account is scheduled for deletion. Cancel the deletion in Settings to do this.')
  })

  // Nobody is left to restrict; the action fails elsewhere for lack of a
  // session.
  it('permits a tombstone', () => {
    expect(
      restrictionMessage({
        deletion_requested_at: '2026-09-06T10:00:00Z',
        deleted_at: '2026-09-21T10:00:00Z',
      }),
    ).toBeNull()
  })

  it('permits a missing profile', () => {
    expect(restrictionMessage(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/settings/restriction.test.ts`
Expected: FAIL — `Cannot find module './restriction'`

- [ ] **Step 3: Write the implementation**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { isPendingDeletion } from './grace'

export const RESTRICTION_MESSAGE =
  'Your account is scheduled for deletion. Cancel the deletion in Settings to do this.'

export function restrictionMessage(
  p: { deletion_requested_at: string | null; deleted_at: string | null } | null,
): string | null {
  if (p == null) return null
  return isPendingDeletion(p) ? RESTRICTION_MESSAGE : null
}

// An account pending deletion must not take on NEW obligations, or the
// guards that passed at request time no longer hold at execution.
export async function assertNotPendingDeletion(
  admin: SupabaseClient<Database>,
  playerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('deletion_requested_at, deleted_at')
    .eq('id', playerId)
    .maybeSingle()
  return restrictionMessage(data ?? null)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/settings/restriction.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire into each Server Action**

In each of the actions listed under **Files**, immediately after the `user` is resolved and before any write, add:

```ts
const restricted = await assertNotPendingDeletion(admin, user.id)
if (restricted) return { error: restricted }
```

Match each action's own return shape — some return `{ error }`, some redirect. Enforce **server-side**; a UI-only check is not sufficient.

The full list of actions to cover, from spec §6: tournament registration and waitlist join, Exchange listing creation, buy request, purchase, friendly challenge issue and accept, wallet deposit, withdrawal request, and wager placement.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all pass

- [ ] **Step 7: Commit**

```bash
git add lib/settings/restriction.ts lib/settings/restriction.test.ts lib/tournaments/actions.ts lib/friendly-matches/ lib/wallet/deposit.ts lib/exchange/
git commit -m "feat(deletion): bar pending accounts from new obligations

Without this the guards that passed at request time no longer hold at
execution — a user could join a tournament on day 3 and be deleted
mid-bracket on day 15.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: i18n copy

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json`

**Interfaces:**
- Produces: an `accountDeletion` namespace consumed by Tasks 14–16.

- [ ] **Step 1: Insert the namespace**

**These files use CRLF.** Insert textually before the `"home": {` line — do not round-trip through `JSON.stringify`, which rewrites every line ending and produces a whole-file diff.

Keys required (English values shown; translate for `fr` and `pcm`):

```
accountDeletion.title                = "Delete account"
accountDeletion.intro                = "This schedules your account for permanent deletion."
accountDeletion.scheduledFor         = "Your account will be permanently deleted on {date}."
accountDeletion.canCancel            = "Until then you can sign in and cancel at any time."
accountDeletion.historyKept          = "Your match history and tournament results will remain visible under \"Deleted player\"."
accountDeletion.usernameRetired      = "Your username {username} will be retired and cannot be used again."
accountDeletion.emailReusable        = "The email address on the account can be used to register again later."
accountDeletion.typeDelete           = "Type DELETE to confirm."
accountDeletion.confirmButton        = "Schedule deletion"
accountDeletion.deleteNowTitle       = "Delete immediately"
accountDeletion.deleteNowWarning     = "This skips the 15-day grace period. Your account is deleted immediately. There is no cancellation and no undo."
accountDeletion.deleteNowPrompt      = "Type your username {username} to confirm."
accountDeletion.deleteNowButton      = "Delete permanently"
accountDeletion.cancel               = "Cancel"
accountDeletion.bannerText           = "Your account is scheduled for deletion on {date} — {days} days left."
accountDeletion.bannerCancel         = "Cancel deletion"
accountDeletion.blockedTitle         = "You can't delete your account yet:"
accountDeletion.blockerWalletBalance = "{amount} wallet balance — withdraw or spend it first"
accountDeletion.blockerWithdrawal    = "{count} pending withdrawal — wait for it to be paid"
accountDeletion.blockerEscrow        = "{count} open Exchange order — complete or cancel it"
accountDeletion.blockerListing       = "{count} live Exchange listing — remove it first"
accountDeletion.blockerTournament    = "You're in an active tournament — wait for it to finish"
accountDeletion.blockerMatch         = "{count} unfinished match — play or resolve it"
accountDeletion.blockerFriendly      = "{count} unfinished friendly — play or decline it"
accountDeletion.restricted           = "Your account is scheduled for deletion. Cancel the deletion in Settings to do this."
```

- [ ] **Step 2: Validate the JSON**

```bash
for l in en fr pcm; do node -e "JSON.parse(require('fs').readFileSync('messages/$l.json','utf8')); console.log('$l ok')"; done
```

Expected: three `ok` lines.

- [ ] **Step 3: Confirm the diff is additive only**

```bash
git diff --stat messages/
```

Expected: roughly equal small insertion counts per file, **zero deletions**. Deletions mean the CRLF rule was broken — revert and redo textually.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json
git commit -m "feat(deletion): account-deletion copy in all three locales

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Settings UI

**Files:**
- Modify: `components/settings/AccountSection.tsx`
- Modify: `app/[locale]/dashboard/settings/page.tsx` — pass `deletionRequestedAt` and `username`

**Interfaces:**
- Consumes: `requestAccountDeletion`, `cancelAccountDeletion`, `deleteAccountNow` (Task 9); `deletionDueAt`, `daysRemaining` (Task 3); the `accountDeletion` namespace (Task 13).

- [ ] **Step 1: Replace `DeleteAccountButton`**

Three states in one client component:

1. **Not pending** — a "Delete Account" button opening the confirm panel. The panel shows `scheduledFor` with the computed date from `deletionDueAt(new Date())`, `canCancel`, `historyKept`, `usernameRetired`, `emailReusable`, a `confirm` text input, and a `confirmButton` submit disabled until the input is exactly `DELETE`. Below it, a less prominent `deleteNowTitle` disclosure containing `deleteNowWarning`, an input, and `deleteNowButton` disabled until the input matches the username case-insensitively.
2. **Blocked** — when the action returns `blockers`, render `blockedTitle` and one line per blocker using the matching `blocker*` key. Keep the panel open.
3. **Pending** — replace the whole section with the scheduled date, `daysRemaining`, and a `bannerCancel` button calling `cancelAccountDeletion`.

Reuse the existing red styling: `border-red-900/50`, `bg-red-950/10`, `bg-red-600` for the destructive submit. Keep the component mobile-first — the panel must not overflow at 375px.

On success of `deleteAccountNow`, sign out and redirect as the current code does:

```ts
await createClient().auth.signOut()
router.push('/')
```

On success of `requestAccountDeletion`, do **not** sign out — the user stays signed in so they can cancel. Call `router.refresh()`.

- [ ] **Step 2: Pass the new props**

In `app/[locale]/dashboard/settings/page.tsx`, select `username, deletion_requested_at` from `profiles` and pass them to `<AccountSection>`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Verify at 375px**

Start the dev server (only if no other `next dev` is running). Sign in, open `/dashboard/settings`, and confirm at 375px width: the confirm panel does not overflow horizontally, the submit stays disabled until the exact text is typed, and the blocked state renders one line per blocker.

- [ ] **Step 5: Commit**

```bash
git add components/settings/AccountSection.tsx "app/[locale]/dashboard/settings/page.tsx"
git commit -m "feat(deletion): settings UI for request, cancel and delete-now

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Pending-deletion banner

**Files:**
- Create: `components/shared/PendingDeletionBanner.tsx`
- Modify: `app/[locale]/layout.tsx` — render it under `SiteHeader`
- Modify: `lib/nav/session.ts` — add `deletionRequestedAt` to `NavSession`

**Interfaces:**
- Consumes: `daysRemaining`, `deletionDueAt` (Task 3); `accountDeletion.bannerText`, `accountDeletion.bannerCancel` (Task 13); `cancelAccountDeletion` (Task 9).

- [ ] **Step 1: Add the field to the session**

In `lib/nav/session.ts`, add `deletionRequestedAt: string | null` to the `NavSession` type, select `deletion_requested_at` in the profile query, and include it in both the populated and `LOGGED_OUT` return values (`null` for logged out).

- [ ] **Step 2: Write the banner**

```tsx
'use client'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { cancelAccountDeletion } from '@/lib/settings/account'
import { deletionDueAt, daysRemaining } from '@/lib/settings/grace'

// Deliberately not dismissible: dismissing the only standing warning about
// impending account deletion defeats the point of showing it.
export function PendingDeletionBanner({ requestedAt }: { requestedAt: string }) {
  const t = useTranslations('accountDeletion')
  const requested = new Date(requestedAt)
  const due = deletionDueAt(requested)
  const left = daysRemaining(requested, new Date())

  return (
    <div className="border-b border-red-900/50 bg-red-950/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 text-xs text-red-200 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('bannerText', { date: due.toDateString(), days: left })}</span>
        </p>
        <form action={cancelAccountDeletion}>
          <button
            type="submit"
            className="whitespace-nowrap rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            {t('bannerCancel')}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render it**

In `app/[locale]/layout.tsx`, directly after `<SiteHeader …/>`:

```tsx
{session.deletionRequestedAt && (
  <PendingDeletionBanner requestedAt={session.deletionRequestedAt} />
)}
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all pass

- [ ] **Step 5: Verify at 375px**

With an account whose `deletion_requested_at` is set manually in the DB, confirm the banner appears on every page, stacks vertically at 375px without overflow, and that Cancel clears it.

- [ ] **Step 6: Commit**

```bash
git add components/shared/PendingDeletionBanner.tsx "app/[locale]/layout.tsx" lib/nav/session.ts
git commit -m "feat(deletion): non-dismissible pending-deletion banner

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Tombstone display across surfaces

**Files:**
- Modify: bracket and match card components, Match Centre, rankings, Hall of Fame, community post and comment authors, friendly matches, Exchange listing seller line, admin player tables, `lib/og/match-card.tsx`
- Modify: `app/[locale]/(public)/players/[username]/page.tsx`

**Interfaces:**
- Consumes: `displayNameFor`, `profileHrefFor`, `isDeleted` (Task 5).

- [ ] **Step 1: Find every player-name render**

```bash
grep -rn "display_name ?? \|display_name ??\|\.display_name" --include="*.tsx" --include="*.ts" app components lib | grep -v node_modules
```

Each hit is a candidate. Many files define a local `nameOf()` helper — those are the ones to replace.

- [ ] **Step 2: Replace each local helper**

Delete the local `nameOf` and import `displayNameFor` instead. Every query feeding it must also select `deleted_at`, or the helper cannot tell a tombstone from a live profile — **this is the step most likely to be missed**. Where the name is wrapped in a `<Link href={`/players/${username}`}>`, use `profileHrefFor` and render plain text when it returns `null`.

- [ ] **Step 3: 404 the tombstone profile page**

In `app/[locale]/(public)/players/[username]/page.tsx`, after loading the profile:

```ts
if (!profile || profile.deleted_at) notFound()
```

Do the same in its `generateMetadata`.

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all pass

- [ ] **Step 5: Verify against a real tombstone**

Anonymise a throwaway test account (Task 7's RPC, committed rather than rolled back), then confirm: brackets show "Deleted player" with no link, rankings still list them in the same position, `/players/<old-username>` 404s, and the match OG image renders without the old name.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(deletion): render tombstones as Deleted player everywhere

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Admin recovery tools

**Files:**
- Create: `app/[locale]/admin/account-recovery/page.tsx`
- Create: `lib/admin/recovery-actions.ts`
- Modify: `lib/admin/nav.ts` — add the route

**Interfaces:**
- Consumes: `hashIdentifier` (Task 4), `requireAdmin` from `lib/admin/auth.ts`.
- Produces: `releaseUsername(prev, formData)`, `clearBannedIdentifier(prev, formData)`.

- [ ] **Step 1: Write the actions**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import { hashIdentifier } from '@/lib/settings/identifier-hash'

export type RecoveryState = { error?: string; success?: string } | undefined

export async function releaseUsername(
  _prev: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const ctx = await requireAdmin()
  const username = String(formData.get('username') ?? '').trim().toLowerCase()
  if (!username) return { error: 'Enter a username.' }

  const admin = createAdminClient()
  const { data } = await admin
    .from('retired_usernames')
    .delete()
    .eq('username', username)
    .select('username')
  if (!data || data.length === 0) return { error: 'That username is not retired.' }

  await admin.from('admin_recovery_log').insert({
    actor_id: ctx.userId,
    action: 'release_username',
    target: username,
  })
  revalidatePath('/admin/account-recovery')
  return { success: `${username} is claimable again — by anyone, not only its previous owner.` }
}

export async function clearBannedIdentifier(
  _prev: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const ctx = await requireAdmin()
  const value = String(formData.get('value') ?? '').trim()
  if (!value) return { error: 'Enter an email or phone number.' }

  const admin = createAdminClient()
  // The stored hash cannot be reversed, so the plaintext is hashed and
  // matched rather than searched for.
  const hash = hashIdentifier(value, process.env.DELETION_HASH_PEPPER ?? '')
  const { data } = await admin
    .from('banned_identifiers')
    .delete()
    .eq('hash', hash)
    .select('hash')
  if (!data || data.length === 0) return { error: 'No ban recorded for that value.' }

  await admin.from('admin_recovery_log').insert({
    actor_id: ctx.userId,
    action: 'clear_identifier',
    target: hash,
  })
  revalidatePath('/admin/account-recovery')
  return { success: 'That identifier can register again.' }
}
```

Note: `target` stores the **hash**, never the plaintext — logging the address would reintroduce the personal data the design removed.

- [ ] **Step 2: Write the page**

A Server Component calling `await requireAdmin()` first, following the shape of `app/[locale]/admin/referrals/page.tsx`. Two small client forms bound to the two actions, plus a table of the 50 most recent `admin_recovery_log` rows joined to the actor's username. Include the warning text from the spec on the username form: releasing a handle lets anyone claim it, since there is no longer a record of who held it.

- [ ] **Step 3: Add to admin nav**

Add `{ href: '/admin/account-recovery', label: 'Account recovery' }` to the admin nav in `lib/admin/nav.ts`, following the existing entry shape.

- [ ] **Step 4: Verify the role gate**

Sign in as a **moderator** and open `/admin/account-recovery`.
Expected: redirected away — `requireAdmin()` refuses. Then sign in as admin and confirm both forms work and log a row.

- [ ] **Step 5: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all pass

- [ ] **Step 6: Commit**

```bash
git add "app/[locale]/admin/account-recovery" lib/admin/recovery-actions.ts lib/admin/nav.ts
git commit -m "feat(deletion): admin recovery for retired usernames and ban hashes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Privacy Policy disclosure

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json` — the `privacy` namespace

**Interfaces:**
- Consumes: nothing. Legal copy for the retention introduced in Task 4.

- [ ] **Step 1: Add the disclosure**

Add a paragraph to the `privacy` namespace covering account deletion and the ban-evasion retention. English text:

> **Deleting your account.** You can delete your account from Settings. Your account is scheduled for deletion after 15 days, and you can cancel at any point during that period. When deletion completes we remove your personal information — your name, avatar, contact details and bio — and your profile is shown as "Deleted player". Your match results, tournament entries and payment records are retained: we need them to keep competition history and financial records accurate, and they no longer identify you. Your username is retired permanently and cannot be reused. Your email address is released and can be used to register a new account.
>
> **One exception.** If an account is removed while flagged for cheating, we keep a one-way cryptographic hash of its email address and phone number so the same person cannot immediately register again. A hash cannot be reversed to recover the original address. We keep these entries indefinitely to enforce the sanction.

Follow the numbering of the existing `privacy` sections. Same CRLF rule as Task 13.

- [ ] **Step 2: Validate and check the diff**

```bash
for l in en fr pcm; do node -e "JSON.parse(require('fs').readFileSync('messages/$l.json','utf8')); console.log('$l ok')"; done
git diff --stat messages/
```

Expected: three `ok` lines; additive diff with zero deletions.

- [ ] **Step 3: Verify it renders**

Open `/privacy` and confirm the new sections appear in the sticky table of contents and are reachable by anchor, in all three locales.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/fr.json messages/pcm.json
git commit -m "docs(privacy): disclose deletion behaviour and ban-evasion hashes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full suite and typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: exit 0, every test passing.

- [ ] **Step 2: Production build**

Confirm no other `next dev` is running first:

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: The case that fails today**

Create a test account with rows in `matches`, `tournament_registrations`, `sx_score_events`, `wallet_deposits` and `marketplace_orders` — the shape that blocks 82 of 102 real users. Request deletion, then run the cron with the grace check bypassed (temporarily pass a past `deletion_requested_at`).

Verify afterwards:

```sql
SELECT username, display_name, deleted_at FROM profiles WHERE id = '<test-id>';
SELECT count(*) FROM matches WHERE player_a_id = '<test-id>' OR player_b_id = '<test-id>';
SELECT count(*) FROM tournament_registrations WHERE player_id = '<test-id>';
SELECT count(*) FROM sx_score_events WHERE player_id = '<test-id>';
SELECT count(*) FROM fcm_tokens WHERE player_id = '<test-id>';
SELECT count(*) FROM retired_usernames WHERE username = '<old-username>';
```

Expected: profile anonymised with `deleted_at` set; matches, registrations and score events **still present**; `fcm_tokens` zero; one retired username.

- [ ] **Step 4: Cancellation**

On a second test account: request deletion, confirm the banner appears and a tournament registration is refused, then cancel. Confirm the banner clears, registration works again, and the username is **not** in `retired_usernames`.

- [ ] **Step 5: Reuse rules**

- Sign up with the deleted account's **email** → succeeds, new empty account.
- Sign up with its **username** → rejected.
- Flag a third test account `severity = 'cheat'`, delete it, then try its email → rejected. Clear it in `/admin/account-recovery` → succeeds.

- [ ] **Step 6: Merge and push**

```bash
git checkout main
git merge <branch>
git push origin main
```

Then confirm the Vercel deployment reaches `READY` before considering the work done.
