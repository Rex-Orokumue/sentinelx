# Admin Shell + Role Gating — Design (#9 sub-project 1 of 6)

**Route:** `/admin`
**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan

## Context

The Admin Dashboard (roadmap #9, the last v1.0 task) is too large for one spec. It is being
built as six sequential sub-projects, each with its own spec → plan → build cycle:

1. **Admin shell + role gating** ← this spec
2. Tournament management (CRUD)
3. Bracket generation (close registration → groups/matches)
4. Match management (slots, live status, YouTube URLs)
5. Result verification (confirm/dispute → advance standings/bracket)
6. Withdrawal queue (resolve pending `withdrawal_requests`)

Deferred to later versions (not part of #9): Gaming Exchange moderation (v3.0), player flags /
Sentinel Score automation (v2.0), financials dashboard.

Current state: `app/admin/` is an empty `.gitkeep`. `middleware.ts` guards `/admin` for
**authentication only** — a logged-in non-staff user can currently reach it. The DB already has
`user_roles`, `is_admin()`, and `is_staff()`. This sub-project closes the role gap and lays the
foundation the other five sit on. **No DB migration.**

## Purpose

Deliver the `/admin` foundation: shared server-side auth helpers, a role-gated layout,
role-aware nav, and a live overview home. Everything is a Server Component; there is no
client interactivity in this sub-project.

## Auth helpers — `lib/admin/auth.ts` (single source of truth)

Mirrors the `RANKING_MIN_MATCHES`/`isRankingEligible` pattern: role logic lives in one module,
imported everywhere it is needed, so a change to the role definition changes one place.

```ts
export type StaffRole = 'admin' | 'moderator'

export interface StaffContext {
  userId: string
  email: string | null
  roles: StaffRole[]
  isStaff: boolean
  isAdmin: boolean
}
```

- **`getStaffContext(): Promise<StaffContext | null>`** — reads the current user via
  `supabase.auth.getUser()`, then queries `user_roles` for that user, keeping only staff roles
  (`admin`/`moderator`; any `player` row is ignored). Returns **distinct shapes** so callers
  never need a second auth check:
  - `null` → not authenticated.
  - `{ userId, email, roles: [], isStaff: false, isAdmin: false }` → authenticated, no staff role.
  - `{ userId, email, roles: [...], isStaff: true, isAdmin: <bool> }` → authenticated staff.
- **`requireStaff(): Promise<StaffContext>`** — the layout gate:
  - `ctx === null` → `redirect('/login?next=/admin')` (no session).
  - `!ctx.isStaff` → `redirect('/dashboard')` (authenticated player belongs on their dashboard,
    not the public landing page).
  - else return `ctx`.
- **`requireAdmin(): Promise<StaffContext>`** — for financial/admin-only surfaces: calls
  `requireStaff()` first (so auth + staff are already handled), then `if (!ctx.isAdmin)
  redirect('/admin')`. Delivered now so sub-project 6's withdrawal actions import it.

`user_roles` RLS already lets a user read their own role rows, so `getStaffContext` works under
the user's session client.

## Layout — `app/admin/layout.tsx` (Server Component)

Calls `requireStaff()` (the gate for every `/admin/*` route), then renders admin chrome:
a header with the SentinelX mark, the role-aware nav, and `{children}`. Passes `isAdmin` to the
nav so admin-only entries are hidden from moderators. Mobile-first.

## Nav registry — `lib/admin/nav.ts` (pure, unit-tested)

```ts
export interface AdminNavItem { label: string; href: string; adminOnly: boolean }
export const ADMIN_NAV: AdminNavItem[]
export function visibleNav(items: AdminNavItem[], isAdmin: boolean): AdminNavItem[]
```

`visibleNav` returns items in original order, dropping `adminOnly` items when `!isAdmin`.
This sub-project seeds `ADMIN_NAV` with **Overview** (`/admin`, not admin-only) only; each later
sub-project appends its entry. Nav lists only built pages — no dead links.

## Home — `app/admin/page.tsx` (Server Component)

An overview of "needs attention" counts, fetched with efficient count-only queries
(`select('*', { count: 'exact', head: true })` — returns the count, no rows):

| Card | Query | Visible to |
|------|-------|-----------|
| Pending results | `match_results` where `status = 'pending'` | all staff |
| Active tournaments | `tournaments` where `status = 'active'` | all staff |
| Open registrations | `tournaments` where `status = 'registration_open'` | all staff |
| Pending withdrawals | `withdrawal_requests` where `status = 'pending'` | **admins only** |

- **Every visible card renders even at a count of 0** — a stable layout; "0 pending results"
  is real, useful signal. Cards do not appear/disappear based on count.
- The Pending-withdrawals card is admin-only (financial); RLS on `withdrawal_requests`
  (`own OR is_admin`) already restricts the count read to admins, so it is also enforced below
  the UI.
- Each card shows a **count + human-readable label**. Cards are **non-linking in this
  sub-project**; when a later sub-project ships the matching management page, that card gains a
  link to it (progressive: informational → link). They do not stay permanently informational.

RLS note: `match_results` `mr_select` lets staff read all rows, so the pending-results count is
correct for staff; `tournaments` is publicly readable.

## Components — `components/admin/`

- `AdminNav.tsx` — renders `visibleNav(ADMIN_NAV, isAdmin)` as links, highlighting the active
  route.
- `StatCard.tsx` — a single overview card: count + label, always rendered. Accepts an optional
  `href` (unused now; later sub-projects pass it to make the card a link).

## Security

- The layout's `requireStaff()` is the single gate for all `/admin/*` pages. `requireAdmin()`
  guards admin-only surfaces (financial). Both live in `lib/admin/auth.ts`.
- Middleware is unchanged — it keeps the early auth redirect for `/admin`; the role decision is
  made server-side in the layout (closer to the data, easy to test, one enforcement point).
- RLS on the counted tables independently restricts what each role can read, so the admin-only
  withdrawal count is enforced at the DB, not just hidden in the UI.

## Testing

Vitest on `lib/admin/nav.ts`:
- `visibleNav` hides `adminOnly` items from a moderator (`isAdmin = false`).
- `visibleNav` shows all items to an admin (`isAdmin = true`).
- Order is preserved.

Auth helpers are I/O-bound (Supabase queries + `redirect`) and are exercised via the build and a
manual role check on the deployed app. (Seeding requires an `admin` row in `user_roles` for the
tester — data, not code.)

## Consistency notes

- Removes the stale `app/admin/.gitkeep` once `app/admin/layout.tsx` + `page.tsx` exist.
- Mobile-first; nav collapses sensibly at 375px; cards stack single-column and grid up.
- No WhatsApp share (admin is private).
