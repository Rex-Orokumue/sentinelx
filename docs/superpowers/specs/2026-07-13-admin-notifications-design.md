# Admin Notifications — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** none functionally, but supersedes the prediction in [player-notification-system-design.md §7](2026-07-13-player-notification-system-design.md) that #27 would become "a staff-filtered view of the same `player_notifications` system." It doesn't — see §2 for why.
**Known merge dependency:** #28 (wallet/perks/recordings, in progress on `feat/28-30-wallet-perks-recordings`) is expected to replace `withdrawal_requests`, `referral_withdrawal_requests`, and `friendly_withdrawal_requests` with a single unified `withdrawal_requests_v2` table. As of this spec, that branch has no commits ahead of `main` yet — the table doesn't exist. Whoever merges #28 **must** update the three withdrawal sources in `getAdminNotificationQueue()` (§3) to point at the new table, or admin withdrawal notifications will silently break.

---

## 1. Goal

Admins/moderators currently have no unified way to see "what needs my attention" across the platform — each `/admin/*` page independently queries its own pending rows, and only two of five queue types (results, withdrawals) are even surfaced on the Overview page. #27 adds:

1. An **admin notification bell** in the admin header — a dropdown feed of pending items across all queue types, newest first, click-to-navigate.
2. **Per-item badge counts** on `AdminSidebar` nav entries (Results, Exchange, Withdrawals, Referrals, Friendly withdrawals).
3. The Overview page's existing "Needs attention" `StatCard`s refactored to read from the same shared source instead of duplicating queries.

## 2. Why this isn't "player_notifications, filtered to staff"

The player system is an **event log**: a row is inserted once, at the moment something happens, and persists forever with an individual read/unread flag per recipient. That model doesn't fit admin queues, because the approved behavior here is different: when *any* admin/moderator resolves a pending item (approves a listing, pays a withdrawal, confirms a result), the notification must disappear **for every staff member at once** — not just for whoever clicked it. Reusing the event-log table would require an insert at every creation call site (most of which write no notification today) plus a `resolved_at` update at every admin action, with two places that can drift out of sync.

Instead, `getAdminNotificationQueue()` is a **live aggregation** over the exact "pending" queries each admin page already runs. There's no new table, no insert/resolve call sites, and no drift risk: a row simply stops appearing the moment the underlying status changes, because it's read fresh on every admin page render. This also matches the project-wide convention (stated explicitly in the player-notification spec) that nothing in this codebase uses Supabase Realtime — everything is server-computed per page load.

## 3. `getAdminNotificationQueue()`

New file: `lib/admin/notification-queue.ts`.

```typescript
export type AdminNotificationType =
  | 'exchange_listing_pending'
  | 'result_needs_review'
  | 'result_disputed'
  | 'withdrawal_pending'
  | 'referral_withdrawal_pending'
  | 'friendly_withdrawal_pending'

export interface AdminNotificationItem {
  type: AdminNotificationType
  title: string
  body: string
  link: string
  createdAt: string
}

export async function getAdminNotificationQueue(
  staffRole: 'admin' | 'moderator'
): Promise<AdminNotificationItem[]>
```

Internally this runs the same queries as today's per-page loads (exchange listings `status='pending'`; withdrawal_requests `status IN ('pending','failed')`; referral_withdrawal_requests `status='pending'`; friendly withdrawal_requests `status='pending'`; matches bucketed by the existing `lib/matches/review-queue.ts` → `bucketReviewQueue` into `needsReview`/`disputed`), maps each row into an `AdminNotificationItem`, and merges/sorts them by `createdAt` descending. When `staffRole === 'moderator'`, the three withdrawal queries are skipped entirely (not fetched, not just filtered from the result) — matching the existing `requireStaff()`/`requireAdmin()` split where moderators have no financial actions.

| Type | Source (pre-#28) | Link | Moderator visible? |
|---|---|---|---|
| `exchange_listing_pending` | `exchange_listings.status='pending'` | `/admin/exchange` | Yes |
| `result_needs_review` | `bucketReviewQueue().needsReview` | `/admin/results` | Yes |
| `result_disputed` | `bucketReviewQueue().disputed` | `/admin/results` | Yes |
| `withdrawal_pending` | `withdrawal_requests` | `/admin/withdrawals` | **Admin only** |
| `referral_withdrawal_pending` | `referral_withdrawal_requests` | `/admin/referrals` | **Admin only** |
| `friendly_withdrawal_pending` | `friendly_withdrawal_requests` | `/admin/friendly-withdrawals` | **Admin only** |

KYC is out of scope — there is no `/admin/kyc` review page in the codebase today (`lib/kyc/actions.ts` has a `requireAdmin()`-gated action but no admin UI consumes it). That's a pre-existing gap, not something #27 silently takes on; it would need its own spec if the team wants it built.

## 4. Wiring

`app/admin/layout.tsx` calls `getAdminNotificationQueue(staffContext.isAdmin ? 'admin' : 'moderator')` once, alongside the existing `requireStaff()` call, and threads the result down as props to `AdminSidebar` (for per-item badge counts, grouped by `type`) and the new `AdminNotificationBell` (for the dropdown + total count). `app/admin/page.tsx` (Overview) is refactored to derive its "Needs attention" `StatCard`s from the same array instead of running its own separate queries, so counts can't drift between Overview and the sidebar/bell.

This means the aggregation query runs on **every** admin page render, not just Overview. At current data volume (a handful of pending items across all queues) this is negligible. If the platform's pending-item volume grows large enough for this to matter, the fix is a short-lived cache (30–60s) around the result — **not built in this spec**, flagged here as a future optimization only.

## 5. Frontend

**`components/admin/AdminNotificationBell.tsx`** — same interaction pattern as the existing player `NotificationBell` (`components/shared/NotificationBell.tsx`): click-to-open dropdown, click-outside + Escape to close, up to 20 items listed. Key difference: no per-row "mark as read" state or click-through mutation — there's nothing to write, since resolution is implicit in the underlying data. Clicking an item just navigates via its `link`. Rendered in the admin header for all staff, unconditionally (no logged-out state to handle, since the whole `/admin` tree is already gated by `requireStaff()`).

**`AdminSidebar`** (`components/admin/AdminSidebar.tsx`, nav from `lib/admin/nav.ts`) — each `ADMIN_NAV` item whose `href` matches one of the queue's link targets gets a small count badge, computed by grouping the shared queue array by `type` → summing per matching `href`. Items with zero matching pending notifications show no badge (not a "0").

**Overview `StatCard`s** (`app/admin/page.tsx`) — the existing "Needs attention" cards (pending results, pending withdrawals) are joined by new cards for pending exchange listings, pending referral withdrawals, and pending friendly withdrawals — all five now sourced from the one shared array instead of one-off queries.

## 6. Out of scope

- Realtime/live badge updates — server-computed per page load only, consistent with the rest of the codebase.
- Any new database table or migration — this is a pure read-aggregation feature.
- KYC review queue/page (§3) — pre-existing gap, not part of this spec.
- The 30–60s caching optimization mentioned in §4 — flagged, not built.
- Updating the withdrawal sources for #28's `withdrawal_requests_v2` — flagged as a merge dependency (top of doc), not performed by this spec since the table doesn't exist yet.
